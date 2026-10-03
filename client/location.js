(() => {
  "use strict";

  function locationErrorMessage(error) {
    if (error?.code === "coarse") return "The location service returned only a broad estimate. Connect to Wi-Fi or check your system location service, then try again.";
    if (error?.code === 1) return "Location permission was declined. Check your system privacy settings.";
    if (error?.code === 2) return "The system location service is unavailable. On Omarchy, install or check GeoClue.";
    if (error?.code === 3) return "Location lookup timed out. Check your connection and try again.";
    return "Your position could not be determined. Try again in a moment.";
  }

  // Five kilometres is already a significant uncertainty for nearby alerts.
  function validLocation(coords) {
    return coords && Number.isFinite(coords.latitude) && Math.abs(coords.latitude) <= 90
      && Number.isFinite(coords.longitude) && Math.abs(coords.longitude) <= 180
      && Number.isFinite(coords.accuracy) && coords.accuracy >= 0 && coords.accuracy <= 5000;
  }

  function locate(geolocation) {
    return new Promise((resolve, reject) => {
      let watchId;
      let finished = false;
      let coarse = false;
      const timer = setTimeout(() => finish(null, { code: coarse ? "coarse" : 3 }), 30000);
      function finish(position, error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (watchId !== undefined) geolocation.clearWatch(watchId);
        if (error) reject(error);
        else resolve(position);
      }
      try {
        watchId = geolocation.watchPosition((position) => {
          if (validLocation(position.coords)) finish(position);
          else coarse = true;
        }, (error) => finish(null, coarse && error.code === 3 ? { code: "coarse" } : error), {
          enableHighAccuracy: true, maximumAge: 0, timeout: 30000,
        });
        if (finished) geolocation.clearWatch(watchId);
      } catch (error) {
        finish(null, error);
      }
    });
  }

  globalThis.StormtraceLocation = { locationErrorMessage, validLocation, locate };
})();
