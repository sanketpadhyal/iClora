import React from 'react';
import { useNavigate } from 'react-router-dom';
import './Home.css';
import WhatWeGive from './WhatWeGive';

const preventTouchPopup = (e) => {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
};

function Home() {
  const navigate = useNavigate();
  const handleSignIn = () => navigate('/auth');
  const handleAbout = () => navigate('/about');

  return (
    <main className="iclora-home">
      <section className="iclora-hero" aria-labelledby="iclora-title">
        <img
          className="iclora-cloud-image"
          src="/iclora-hero-cloud.webp"
          width="500"
          height="500"
          loading="eager"
          decoding="async"
          alt=""
          aria-hidden="true"
        />

        <h1 id="iclora-title" className="iclora-title">iClora</h1>

        <div className="iclora-actions">
          <button
            className="iclora-signin"
            onClick={handleSignIn}
            onContextMenu={preventTouchPopup}
            onTouchStart={preventTouchPopup}
          >
            Sign In
          </button>

          <button className="iclora-about" onClick={handleAbout} onContextMenu={preventTouchPopup} onTouchStart={preventTouchPopup}>
            <img src="/about.webp" alt="" aria-hidden="true" />
            <span>About</span>
          </button>
        </div>

        <p className="iclora-tagline">
          The best place for all your photos, files, notes, and more.
        </p>
      </section>

      <WhatWeGive />
    </main>
  );
}

export default Home;
