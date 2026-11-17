import { Capacitor } from '@capacitor/core';
import {
  AdMob,
  AdmobConsentStatus,
  BannerAdPosition,
  BannerAdSize
} from '@capacitor-community/admob';

const TEST_IDS = {
  // Google's official Android demo ad units.
  banner: 'ca-app-pub-3940256099942544/9214589741',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917'
};

let config = null;
let initialized = false;
let initializationPromise = null;
let interstitialReady = false;
let interstitialBusy = false;
let rewardedBusy = false;

function readConfig() {
  try {
    const project = JSON.parse(localStorage.getItem('gamezaar_racing_settings') || '{}');
    return project.monetization || {};
  } catch (_) {
    return {};
  }
}

function isNative() {
  try { return Capacitor.isNativePlatform(); } catch (_) { return false; }
}

function adOptions(format) {
  const testMode = config?.testMode !== false;
  const customId = format === 'banner' ? config?.bannerId :
    format === 'interstitial' ? config?.interstitialId : config?.rewardedId;
  return {
    adId: testMode ? TEST_IDS[format] : String(customId || '').trim(),
    isTesting: testMode
  };
}

function dispatch(name, detail = {}) {
  try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (_) {}
}

async function requestConsent() {
  try {
    const info = await AdMob.requestConsentInfo();
    if (info?.isConsentFormAvailable && info.status === AdmobConsentStatus.REQUIRED) {
      await AdMob.showConsentForm();
    }
    const latest = await AdMob.requestConsentInfo();
    return latest?.canRequestAds === true;
  } catch (error) {
    console.warn('[GAMEZAAR Ads] Consent check failed; ads remain disabled until consent is resolved.', error);
    return false;
  }
}

async function preloadInterstitial() {
  if (!initialized || !config?.interstitialOn || interstitialBusy) return false;
  const options = adOptions('interstitial');
  if (!options.adId) return false;
  try {
    await AdMob.prepareInterstitial(options);
    interstitialReady = true;
    return true;
  } catch (error) {
    interstitialReady = false;
    console.warn('[GAMEZAAR Ads] Interstitial preload failed.', error);
    return false;
  }
}

function showPreviewAd(format) {
  return new Promise(resolve => {
    const old = document.getElementById('gamezaarAdPreviewOverlay');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'gamezaarAdPreviewOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(5,5,12,.94);font-family:system-ui,sans-serif;';
    const rewarded = format === 'rewarded';
    overlay.innerHTML = '<div style="width:min(100%,360px);padding:22px;border:1px solid #ffca75;border-radius:18px;background:linear-gradient(145deg,#302744,#171326);color:#fff4dc;text-align:center;box-shadow:0 18px 55px #000b"><div style="font-size:10px;letter-spacing:2px;color:#ffca75;font-weight:900">GAMEZAAR · AD PREVIEW</div><h2 style="margin:12px 0 8px;font-size:20px">'+(rewarded?'Rewarded Video Demo':'Interstitial Ad Demo')+'</h2><p style="font-size:12px;line-height:1.55;color:#c9c1d8">This is a browser simulation only. No Google ad is requested, no ad is clicked, and no revenue is earned.</p><div style="height:82px;margin:15px 0;border:1px dashed #ffca7588;border-radius:10px;display:grid;place-items:center;color:#ffdda2;font-size:12px;font-weight:800">'+(rewarded?'DEMO VIDEO AD':'DEMO FULL-SCREEN AD')+'</div><div style="display:grid;gap:9px"><button id="gzPreviewAdPrimary" style="padding:12px;border:0;border-radius:10px;background:linear-gradient(135deg,#ffe0a0,#ffb84d);color:#281c31;font-weight:900">'+(rewarded?'Complete Demo Ad & Earn Revival':'Continue Game')+'</button><button id="gzPreviewAdClose" style="padding:10px;border:1px solid #ffffff35;border-radius:10px;background:#ffffff12;color:#fff4dc;font-weight:700">'+(rewarded?'Close without reward':'Close')+'</button></div></div>';
    const cleanup = value => { overlay.remove(); resolve(value); };
    overlay.querySelector('#gzPreviewAdPrimary').addEventListener('click', () => cleanup(rewarded ? { earned: true, demo: true, reward: { type: 'demo-revival', amount: 1 } } : true));
    overlay.querySelector('#gzPreviewAdClose').addEventListener('click', () => cleanup(rewarded ? { earned: false, demo: true } : false));
    document.body.appendChild(overlay);
  });
}

async function initializeAds() {
  if (!config) config = readConfig();
  if (!isNative()) return false;
  if (initialized) return true;
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    config = readConfig();
    const enabled = !!(config.bannerOn || config.interstitialOn || config.rewardedOn);
    if (!enabled) return false;

    const activeFormats = [
      ['banner', config.bannerOn, config.bannerId],
      ['interstitial', config.interstitialOn, config.interstitialId],
      ['rewarded', config.rewardedOn, config.rewardedId]
    ].filter(item => item[1]);

    if (config.testMode === false) {
      const missing = activeFormats.filter(item => !String(item[2] || '').trim()).map(item => item[0]);
      if (missing.length) {
        console.warn('[GAMEZAAR Ads] Add production Ad Unit IDs for enabled formats:', missing.join(', '));
        dispatch('gamezaar:ads-error', { reason: 'missing-ad-unit-id', formats: missing });
        return false;
      }
    }

    if (!(await requestConsent())) {
      dispatch('gamezaar:ads-consent-required');
      return false;
    }

    try {
      await AdMob.initialize();
      initialized = true;

      if (config.bannerOn) {
        const options = adOptions('banner');
        await AdMob.showBanner({
          ...options,
          adSize: BannerAdSize.ADAPTIVE_BANNER,
          position: config.bannerPosition === 'top'
            ? BannerAdPosition.TOP_CENTER
            : BannerAdPosition.BOTTOM_CENTER,
          margin: 0
        });
        dispatch('gamezaar:banner-requested', { position: config.bannerPosition || 'bottom' });
      }

      if (config.interstitialOn) preloadInterstitial();
      dispatch('gamezaar:ads-ready', { mode: config.testMode === false ? 'production' : 'test' });
      return true;
    } catch (error) {
      initialized = false;
      console.warn('[GAMEZAAR Ads] SDK initialization failed; gameplay will continue without ads.', error);
      dispatch('gamezaar:ads-error', { reason: 'initialization-failed', message: String(error?.message || error) });
      return false;
    }
  })();

  try { return await initializationPromise; }
  finally { initializationPromise = null; }
}

async function showInterstitial() {
  if (!config) config = readConfig();
  if (!isNative()) return config?.interstitialOn ? !!(await showPreviewAd('interstitial')) : false;
  if (!config?.interstitialOn || interstitialBusy) return false;
  if (!initialized && !(await initializeAds())) return false;

  interstitialBusy = true;
  try {
    if (!interstitialReady && !(await preloadInterstitial())) return false;
    await AdMob.showInterstitial();
    interstitialReady = false;
    dispatch('gamezaar:interstitial-shown');
    return true;
  } catch (error) {
    interstitialReady = false;
    console.warn('[GAMEZAAR Ads] Interstitial could not be shown.', error);
    dispatch('gamezaar:ads-error', { reason: 'interstitial-failed', message: String(error?.message || error) });
    return false;
  } finally {
    interstitialBusy = false;
    if (initialized && config?.interstitialOn) preloadInterstitial();
  }
}

async function showRewarded() {
  if (!config) config = readConfig();
  if (!isNative()) return config?.rewardedOn ? await showPreviewAd('rewarded') : { earned: false, reason: 'rewarded-not-enabled' };
  if (!config?.rewardedOn || rewardedBusy) return { earned: false, reason: 'rewarded-not-available' };
  if (!initialized && !(await initializeAds())) {
    return { earned: false, reason: 'ads-not-initialized' };
  }

  rewardedBusy = true;
  try {
    const options = adOptions('rewarded');
    if (!options.adId) return { earned: false, reason: 'missing-ad-unit-id' };
    await AdMob.prepareRewardVideoAd(options);
    // This promise resolves only after the SDK confirms that the user earned the reward.
    const reward = await AdMob.showRewardVideoAd();
    const earned = !!reward && typeof reward === 'object';
    const result = { earned, reward: earned ? reward : null };
    dispatch('gamezaar:rewarded', result);
    return result;
  } catch (error) {
    console.warn('[GAMEZAAR Ads] Rewarded ad was not completed or could not be shown.', error);
    const result = { earned: false, reason: 'not-earned', error: String(error?.message || error) };
    dispatch('gamezaar:rewarded', result);
    return result;
  } finally {
    rewardedBusy = false;
  }
}

window.GAMEZAAR_ADS = {
  initialize: initializeAds,
  showInterstitial,
  showRewarded,
  isNative,
  isPreview: () => !isNative(),
  getMode: () => config?.testMode === false ? 'production' : 'test',
  getStatus: () => ({ initialized, bannerOn: !!config?.bannerOn, interstitialOn: !!config?.interstitialOn, rewardedOn: !!config?.rewardedOn })
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAds, { once: true });
} else {
  initializeAds();
}
