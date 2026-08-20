import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAlert } from '../../alert/alert';
import { useImageProtection } from '../../components/utils/Imageprotector';
import { markProfilePhotoCompleted, writeAuthCache } from '../authCache';
import { apiFetch } from '../../api/backendapi';
import { clearSignedOutData } from '../sessionCleanup';
import { writeUserProfileCache } from '../../cloud/userProfileCache';
import './ProfilePhoto.css';

const MIN_CROP_SCALE = 0.5;
const MAX_CROP_SCALE = 2.5;
const PNG_MIME_TYPE = 'image/png';

function isPngFile(file) {
  return String(file?.type || '').toLowerCase() === PNG_MIME_TYPE;
}

async function convertImageToWebp(file, { maxSize = 1024, quality = 0.86 } = {}) {
  if (!file?.type?.startsWith('image/')) {
    throw new Error('Please select an image file.');
  }

  const srcUrl = URL.createObjectURL(file);
  try {
    const bitmap = typeof createImageBitmap === 'function'
      ? await createImageBitmap(file, { imageOrientation: 'from-image' })
      : await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not load image.'));
        img.src = srcUrl;
      });

    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const targetW = Math.max(1, Math.round(bitmap.width * scale));
    const targetH = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not process image.');

    ctx.drawImage(bitmap, 0, 0, targetW, targetH);

    const blob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/webp', quality);
    });

    if (!blob) throw new Error('WebP conversion failed.');

    const baseName = (file.name || 'profile-photo').replace(/\.[^/.]+$/, '');
    return new File([blob], `${baseName}.webp`, { type: 'image/webp' });
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}

async function prepareUploadFile(file) {
  if (!file?.type?.startsWith('image/')) {
    throw new Error('Please select an image file.');
  }
  if (isPngFile(file)) return file;
  return convertImageToWebp(file);
}

function clampCropTransform(next, metrics, imageSize) {
  const scale = Math.max(MIN_CROP_SCALE, Math.min(MAX_CROP_SCALE, next.scale));
  const displayW = imageSize.width * metrics.baseScale * scale;
  const displayH = imageSize.height * metrics.baseScale * scale;
  const maxX = Math.max(0, (displayW - metrics.viewportSize) / 2);
  const maxY = Math.max(0, (displayH - metrics.viewportSize) / 2);

  return {
    scale,
    x: Math.min(maxX, Math.max(-maxX, next.x)),
    y: Math.min(maxY, Math.max(-maxY, next.y)),
  };
}

function getCropDisplay(metrics, transform, imageSize) {
  const displayW = imageSize.width * metrics.baseScale * transform.scale;
  const displayH = imageSize.height * metrics.baseScale * transform.scale;
  return {
    displayW,
    displayH,
    offsetX: transform.x,
    offsetY: transform.y,
  };
}

async function cropImageForUpload(imageEl, transform, metrics, baseName, outputMimeType = 'image/webp') {
  const outputSize = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not crop image.');

  const naturalW = imageEl.naturalWidth || imageEl.width;
  const naturalH = imageEl.naturalHeight || imageEl.height;
  const exportScale = outputSize / metrics.viewportSize;
  const displayW = naturalW * metrics.baseScale * transform.scale * exportScale;
  const displayH = naturalH * metrics.baseScale * transform.scale * exportScale;
  const left = (outputSize - displayW) / 2 + (transform.x * exportScale);
  const top = (outputSize - displayH) / 2 + (transform.y * exportScale);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outputSize, outputSize);
  ctx.drawImage(imageEl, left, top, displayW, displayH);

  const quality = outputMimeType === PNG_MIME_TYPE ? undefined : 0.92;
  const blob = await new Promise((resolve) => {
    canvas.toBlob((nextBlob) => resolve(nextBlob), outputMimeType, quality);
  });

  if (!blob) throw new Error('Crop export failed.');

  const extension = outputMimeType === PNG_MIME_TYPE ? 'png' : 'webp';
  return new File([blob], `${baseName}-cropped.${extension}`, { type: outputMimeType });
}

function ProfilePhoto({ gateLoading = false }) {
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const imgProtection = useImageProtection();
  const fileInputRef = useRef(null);
  const cropViewportRef = useRef(null);
  const cropImageRef = useRef(null);
  const cropDragRef = useRef(null);
  const [file, setFile] = useState(null);
  const [originalFile, setOriginalFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [signOutPromptOpen, setSignOutPromptOpen] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropImageLoaded, setCropImageLoaded] = useState(false);
  const [cropReady, setCropReady] = useState(false);
  const [cropMetrics, setCropMetrics] = useState({ viewportSize: 0, baseScale: 1 });
  const [cropTransform, setCropTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [cropping, setCropping] = useState(false);

  const previewUrl = useMemo(() => {
    if (!file) return null;
    return URL.createObjectURL(file);
  }, [file]);

  const cropSourceUrl = useMemo(() => {
    const source = originalFile || file;
    if (!source) return null;
    return URL.createObjectURL(source);
  }, [file, originalFile]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      if (cropSourceUrl) URL.revokeObjectURL(cropSourceUrl);
    };
  }, [cropSourceUrl]);

  useEffect(() => {
    if (!cropOpen || !cropSourceUrl) return undefined;

    let raf = 0;
    let observer = null;

    const syncMetrics = () => {
      const viewport = cropViewportRef.current;
      const image = cropImageRef.current;
      if (!viewport || !image || !image.naturalWidth || !image.naturalHeight) return;

      const rect = viewport.getBoundingClientRect();
      const viewportSize = Math.min(rect.width, rect.height);
      if (!viewportSize) return;

      // Start from a "show the full photo" fit so the modal opens with the
      // image visible as-is before the user begins cropping.
      const baseScale = Math.min(viewportSize / image.naturalWidth, viewportSize / image.naturalHeight);
      const nextMetrics = { viewportSize, baseScale };
      setCropMetrics(nextMetrics);
      setCropTransform((current) =>
        clampCropTransform(current, nextMetrics, {
          width: image.naturalWidth,
          height: image.naturalHeight,
        })
      );
      setCropReady(true);
    };

    raf = window.requestAnimationFrame(syncMetrics);
    if (typeof ResizeObserver !== 'undefined' && cropViewportRef.current) {
      observer = new ResizeObserver(syncMetrics);
      observer.observe(cropViewportRef.current);
    }

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      if (observer) observer.disconnect();
    };
  }, [cropOpen, cropSourceUrl, cropImageLoaded]);

  useEffect(() => {
    if (!cropOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !cropping) {
        setCropOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cropOpen, cropping]);

  const handleUpload = async () => {
    if (!file) {
      showAlert({ title: 'Select a Photo', message: 'Please choose an image to continue.', type: 'info' });
      return;
    }
    if (uploading) return;

    setUploading(true);
    try {
      const uploadFile = await prepareUploadFile(file);
      const formData = new FormData();
      formData.append('photo', uploadFile);

      const response = await apiFetch('/users/me/profile-photo', {
        method: 'POST',
        body: formData,
      });

      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Upload failed');
      }

      writeAuthCache({ ok: true, needsProfilePhoto: false });
      writeUserProfileCache({
        name: '',
        email: '',
        profilePhotoUrl: json?.profilePhotoUrl || json?.url || '',
        plan: 'basic',
        storage: typeof json?.storage === 'number' ? json.storage : 1024,
        storageused: typeof json?.storageused === 'number' ? json.storageused : 0,
        storageBreakdown: Array.isArray(json?.storageBreakdown) ? json.storageBreakdown : [],
      });
      markProfilePhotoCompleted();
      showAlert({ title: 'Saved', message: 'Your profile photo has been updated.', type: 'success' });
      navigate('/cloud', { replace: true, state: { profilePhotoCompleted: true } });
    } catch (error) {
      showAlert({
        title: 'Upload Failed',
        message: error?.message || 'Could not upload your profile photo.',
        type: 'error',
        duration: 4200,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleAbort = () => {
    if (uploading || loggingOut) return;
    setSignOutPromptOpen(true);
  };

  const handleOpenCrop = () => {
    if ((!file && !originalFile) || uploading || loggingOut) return;
    setCropImageLoaded(false);
    setCropReady(false);
    setCropTransform({ scale: 1, x: 0, y: 0 });
    setCropOpen(true);
  };

  const handleCropPointerDown = (event) => {
    if (!cropReady || cropping) return;
    cropDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: cropTransform.x,
      originY: cropTransform.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCropPointerMove = (event) => {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = {
      ...cropTransform,
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    };
    setCropTransform(clampCropTransform(next, cropMetrics, {
      width: cropImageRef.current?.naturalWidth || 1,
      height: cropImageRef.current?.naturalHeight || 1,
    }));
  };

  const handleCropPointerUp = (event) => {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    cropDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  };

  const handleApplyCrop = async () => {
    if (!cropImageRef.current || !cropReady || cropping) return;
    setCropping(true);
    try {
      const baseName = ((originalFile || file)?.name || 'profile-photo').replace(/\.[^/.]+$/, '');
      const sourceFile = originalFile || file;
      const outputMimeType = isPngFile(sourceFile) ? PNG_MIME_TYPE : 'image/webp';
      const nextFile = await cropImageForUpload(cropImageRef.current, cropTransform, cropMetrics, baseName, outputMimeType);
      setFile(nextFile);
      setCropOpen(false);
    } catch (error) {
      showAlert({
        title: 'Crop Failed',
        message: error?.message || 'Could not crop your photo.',
        type: 'error',
        duration: 3800,
      });
    } finally {
      setCropping(false);
    }
  };

  const handleCancelSignOut = () => {
    if (loggingOut) return;
    setSignOutPromptOpen(false);
  };

  const handleConfirmSignOut = async () => {
    if (uploading || loggingOut) return;
    setLoggingOut(true);
    const logoutRequest = apiFetch('/auth/logout', {
      method: 'POST',
      keepalive: true,
    }).catch(() => null);
    await clearSignedOutData({ maxWaitMs: 250 });
    navigate('/auth', { replace: true });
    void logoutRequest;
  };

  const cropImageSize = {
    width: cropImageRef.current?.naturalWidth || 1,
    height: cropImageRef.current?.naturalHeight || 1,
  };
  const cropLayout = getCropDisplay(cropMetrics, cropTransform, cropImageSize);

  return (
    <main className={`iclora-profile-photo ${gateLoading ? 'is-loading' : ''}`} aria-label="Profile photo setup">
      <section
        className="iclora-profile-photo__card"
        aria-label="Set profile photo"
      >
        <button
          type="button"
          className="iclora-profile-photo__abort"
          onClick={handleAbort}
          disabled={uploading || loggingOut}
          aria-label="Log out"
        >
          <img src={`${process.env.PUBLIC_URL}/cross-button.webp`} alt="" aria-hidden="true" />
        </button>

        <div className="iclora-profile-photo__hero">
          <img
            className="iclora-profile-photo__hero-image"
            src={`${process.env.PUBLIC_URL}/76f1d34430c4076179bde894b93b1c37579f0926%20(1).webp`}
            alt="Profile setup illustration"
            loading="eager"
            decoding="async"
            {...imgProtection}
          />
        </div>

        <h1 className="iclora-profile-photo__title">
          Set your <span className="iclora-profile-photo__title-accent">profile photo</span>
        </h1>
        <p className="iclora-profile-photo__subtitle">
          Add a photo so your account looks more personal. You can change it anytime later.
        </p>

        <div className="iclora-profile-photo__preview">
          <div className="iclora-profile-photo__avatar-shell">
            <button
              type="button"
              className="iclora-profile-photo__avatar-button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Choose a profile photo"
              disabled={uploading}
            >
              <div className="iclora-profile-photo__avatar" aria-label="Profile photo preview">
                {previewUrl ? (
                  <img src={previewUrl} alt="Selected profile preview" />
                ) : (
                  <div className="iclora-profile-photo__avatar-fallback">You</div>
                )}
              </div>
            </button>

            {previewUrl && (
              <button
                type="button"
                className="iclora-profile-photo__crop-button"
                onClick={handleOpenCrop}
                disabled={uploading || loggingOut}
                aria-label="Crop selected photo"
              >
                <img src={`${process.env.PUBLIC_URL}/crop.webp`} alt="" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <div className="iclora-profile-photo__actions">
          <div className="iclora-profile-photo__file">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const nextFile = e.target.files?.[0] || null;
                setFile(nextFile);
                setOriginalFile(nextFile);
              }}
              disabled={uploading}
              aria-label="Choose profile photo"
            />
          </div>

          <button type="button" className="iclora-profile-photo__button" onClick={handleUpload} disabled={uploading}>
            {uploading ? (
              <>
                <span className="iclora-profile-photo__spinner" aria-hidden="true" />
                Uploading...
              </>
            ) : (
              'Save and Continue'
            )}
          </button>
        </div>
      </section>

      {cropOpen && cropSourceUrl && (
        <div className="iclora-profile-photo__crop-layer" role="presentation">
          <div
            className="iclora-profile-photo__crop-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="iclora-crop-title"
            aria-describedby="iclora-crop-copy"
          >
            <div className="iclora-profile-photo__crop-head">
              <div>
                <h2 id="iclora-crop-title">Crop Photo</h2>
                <p id="iclora-crop-copy">Drag to reposition and use zoom for the framing you want.</p>
              </div>
              <button
                type="button"
                className="iclora-profile-photo__crop-close"
                onClick={() => setCropOpen(false)}
                disabled={cropping}
                aria-label="Close crop editor"
              >
                ×
              </button>
            </div>

            <div
              ref={cropViewportRef}
              className="iclora-profile-photo__crop-viewport"
              onPointerDown={handleCropPointerDown}
              onPointerMove={handleCropPointerMove}
              onPointerUp={handleCropPointerUp}
              onPointerCancel={handleCropPointerUp}
              style={{ cursor: cropping ? 'progress' : 'grab' }}
            >
              <img
                ref={cropImageRef}
                src={cropSourceUrl}
                alt="Crop preview"
                className="iclora-profile-photo__crop-image"
                onLoad={() => setCropImageLoaded(true)}
                draggable={false}
                style={{
                  width: `${cropLayout.displayW}px`,
                  height: `${cropLayout.displayH}px`,
                  left: '50%',
                  top: '50%',
                  transform: `translate(-50%, -50%) translate(${cropLayout.offsetX}px, ${cropLayout.offsetY}px)`,
                }}
              />
              <div className="iclora-profile-photo__crop-frame" aria-hidden="true" />
            </div>

            <div className="iclora-profile-photo__zoom-row">
              <span>Zoom</span>
              <input
                type="range"
                min={MIN_CROP_SCALE}
                max={MAX_CROP_SCALE}
                step="0.01"
                value={cropTransform.scale}
                onChange={(event) => {
                  const scale = Number(event.target.value);
                  setCropTransform((current) =>
                    clampCropTransform({ ...current, scale }, cropMetrics, {
                      width: cropImageRef.current?.naturalWidth || 1,
                      height: cropImageRef.current?.naturalHeight || 1,
                    })
                  );
                }}
                disabled={cropping}
                aria-label="Zoom crop"
              />
            </div>

            <div className="iclora-profile-photo__crop-actions">
              <button
                type="button"
                className="iclora-profile-photo__crop-button-secondary"
                onClick={() => setCropOpen(false)}
                disabled={cropping}
              >
                Cancel
              </button>
              <button
                type="button"
                className="iclora-profile-photo__crop-button-primary"
                onClick={handleApplyCrop}
                disabled={cropping || !cropReady}
              >
                {cropping ? 'Cropping...' : 'Use Crop'}
              </button>
            </div>
          </div>
        </div>
      )}

      {signOutPromptOpen && (
        <div className="iclora-profile-photo__modal-layer" role="presentation">
          <div
            className="iclora-profile-photo__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="iclora-sign-out-title"
            aria-describedby="iclora-sign-out-copy"
          >
            <div className="iclora-profile-photo__modal-icon" aria-hidden="true">
              <img src={`${process.env.PUBLIC_URL}/logout.webp`} alt="" />
            </div>
            <h2 id="iclora-sign-out-title">Sign Out</h2>
            <p id="iclora-sign-out-copy">
              Your current setup will be paused and you will get sign out.
            </p>
            <div className="iclora-profile-photo__modal-actions">
              <button
                type="button"
                className="iclora-profile-photo__modal-button iclora-profile-photo__modal-button--cancel"
                onClick={handleCancelSignOut}
                disabled={loggingOut}
              >
                Cancel
              </button>
              <button
                type="button"
                className="iclora-profile-photo__modal-button iclora-profile-photo__modal-button--danger"
                onClick={handleConfirmSignOut}
                disabled={loggingOut}
              >
                {loggingOut ? 'Signing Out' : 'Sign Out'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default ProfilePhoto;
