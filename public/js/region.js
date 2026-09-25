(function () {
  'use strict';

  const STORAGE_KEY = 'pickr_region';
  const REGIONS = {
    ontario: { label: 'Ontario, Canada', shortLabel: 'Ontario' },
    canada: { label: 'Rest of Canada', shortLabel: 'Canada' },
    uk: { label: 'United Kingdom', shortLabel: 'UK' }
  };

  function getRegion() {
    const saved = localStorage.getItem(STORAGE_KEY);
    return REGIONS[saved] ? saved : 'ontario';
  }

  function setRegion(region) {
    if (!REGIONS[region]) return;
    localStorage.setItem(STORAGE_KEY, region);
    document.dispatchEvent(new CustomEvent('pickr:regionchange', { detail: { region } }));
  }

  function getPerksUrl(region) {
    const urls = (window.PICKR_CONFIG && window.PICKR_CONFIG.REGION_PERKS_URLS) || {};
    return urls[region || getRegion()] || 'region-perks.html';
  }

  function refreshRegionUI() {
    const region = getRegion();
    const info = REGIONS[region];
    document.querySelectorAll('[data-region-label]').forEach((element) => {
      element.textContent = element.dataset.regionLabel === 'short' ? info.shortLabel : info.label;
    });
    document.querySelectorAll('[data-region-perks-link]').forEach((link) => {
      link.href = getPerksUrl(region);
    });
    document.querySelectorAll('[data-region-choice]').forEach((button) => {
      const isSelected = button.dataset.regionChoice === region;
      button.setAttribute('aria-pressed', String(isSelected));
      button.classList.toggle('is-selected', isSelected);
    });
  }

  window.PickrRegion = { REGIONS, getRegion, setRegion, getPerksUrl, refreshRegionUI };
  document.addEventListener('DOMContentLoaded', () => {
    refreshRegionUI();
    document.querySelectorAll('[data-region-choice]').forEach((button) => {
      button.addEventListener('click', () => {
        setRegion(button.dataset.regionChoice);
        refreshRegionUI();
      });
    });
  });
  document.addEventListener('pickr:regionchange', refreshRegionUI);
})();