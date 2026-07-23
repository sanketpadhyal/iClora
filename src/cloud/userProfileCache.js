const STORAGE_KEY = 'iclora_cloud_profile_v2';

function normalizeStorageBreakdown(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      key: typeof item?.key === 'string' ? item.key : '',
      label: typeof item?.label === 'string' ? item.label : '',
      color: typeof item?.color === 'string' ? item.color : '',
      active: item?.active === true,
      storageUsed: typeof item?.storageUsed === 'number' && Number.isFinite(item.storageUsed) ? item.storageUsed : 0,
    }))
    .filter((item) => item.key);
}

export function readUserProfileCache() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.name !== 'string') return null;
    if (typeof parsed.email !== 'string') return null;
    if (typeof parsed.uid !== 'undefined' && typeof parsed.uid !== 'string') return null;
    if (typeof parsed.profilePhotoUrl !== 'string') return null;
    parsed.birthDate = typeof parsed.birthDate === 'string' ? parsed.birthDate : '';
    parsed.dob = typeof parsed.dob === 'string' ? parsed.dob : parsed.birthDate;
    parsed.countryCode = typeof parsed.countryCode === 'string' ? parsed.countryCode : '';
    parsed.countryName = typeof parsed.countryName === 'string' ? parsed.countryName : '';
    parsed.provider = typeof parsed.provider === 'string' ? parsed.provider : '';
    parsed.createdAt = typeof parsed.createdAt === 'string' ? parsed.createdAt : '';
    parsed.lastLoginBy = typeof parsed.lastLoginBy === 'string' ? parsed.lastLoginBy : '';
    parsed.lastLoginAt = typeof parsed.lastLoginAt === 'string' ? parsed.lastLoginAt : '';
    parsed.profilePhotoUpdatedAt = typeof parsed.profilePhotoUpdatedAt === 'string' ? parsed.profilePhotoUpdatedAt : '';
    parsed.firstName = typeof parsed.firstName === 'string' ? parsed.firstName : '';
    parsed.middleName = typeof parsed.middleName === 'string' ? parsed.middleName : '';
    parsed.lastName = typeof parsed.lastName === 'string' ? parsed.lastName : '';
    parsed.plan = typeof parsed.plan === 'string' ? parsed.plan : 'basic';
    parsed.storage = typeof parsed.storage === 'number' && Number.isFinite(parsed.storage) ? parsed.storage : 1024;
    parsed.storageused = typeof parsed.storageused === 'number' && Number.isFinite(parsed.storageused) ? parsed.storageused : 0;
    parsed.storageBreakdown = normalizeStorageBreakdown(parsed.storageBreakdown);
    return parsed;
  } catch {
    return null;
  }
}

export function writeUserProfileCache(profile) {
  if (typeof window === 'undefined') return;
  try {
    const existing = readUserProfileCache() || {};
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        name: typeof profile?.name === 'string' ? profile.name : (existing.name || ''),
        email: typeof profile?.email === 'string' ? profile.email : (existing.email || ''),
        uid: typeof profile?.uid === 'string' ? profile.uid : (existing.uid || ''),
        profilePhotoUrl: typeof profile?.profilePhotoUrl === 'string' ? profile.profilePhotoUrl : (existing.profilePhotoUrl || ''),
        firstName: typeof profile?.firstName === 'string' ? profile.firstName : (existing.firstName || ''),
        middleName: typeof profile?.middleName === 'string' ? profile.middleName : (existing.middleName || ''),
        lastName: typeof profile?.lastName === 'string' ? profile.lastName : (existing.lastName || ''),
        birthDate: typeof profile?.birthDate === 'string' ? profile.birthDate : (existing.birthDate || ''),
        dob: typeof profile?.dob === 'string' ? profile.dob : (existing.dob || ''),
        countryCode: typeof profile?.countryCode === 'string' ? profile.countryCode : (existing.countryCode || ''),
        countryName: typeof profile?.countryName === 'string' ? profile.countryName : (existing.countryName || ''),
        provider: typeof profile?.provider === 'string' ? profile.provider : (existing.provider || ''),
        createdAt: typeof profile?.createdAt === 'string' ? profile.createdAt : (existing.createdAt || ''),
        lastLoginBy: typeof profile?.lastLoginBy === 'string' ? profile.lastLoginBy : (existing.lastLoginBy || ''),
        lastLoginAt: typeof profile?.lastLoginAt === 'string' ? profile.lastLoginAt : (existing.lastLoginAt || ''),
        profilePhotoUpdatedAt: typeof profile?.profilePhotoUpdatedAt === 'string' ? profile.profilePhotoUpdatedAt : (existing.profilePhotoUpdatedAt || ''),
        plan: typeof profile?.plan === 'string' ? profile.plan : (existing.plan || 'basic'),
        storage:
          typeof profile?.storage === 'number' && Number.isFinite(profile.storage)
            ? profile.storage
            : (typeof existing.storage === 'number' ? existing.storage : 1024),
        storageused:
          typeof profile?.storageused === 'number' && Number.isFinite(profile.storageused)
            ? profile.storageused
            : (typeof existing.storageused === 'number' ? existing.storageused : 0),
        storageBreakdown: normalizeStorageBreakdown(profile?.storageBreakdown || existing.storageBreakdown),
      }),
    );
  } catch {

  }
}

export function clearUserProfileCache() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {

  }
}
