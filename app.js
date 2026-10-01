// Supabase client (named "db" so it doesn't clash with the library's own "supabase" name)
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Each phone gets its own driver id, saved so it stays the same next time.
let driverId = null;
try { driverId = localStorage.getItem("lr_driver_id"); } catch (e) {}
if (!driverId) {
  driverId = "driver-" + Math.random().toString(36).slice(2, 9);
  try { localStorage.setItem("lr_driver_id", driverId); } catch (e) {}
}

let map, myMarker, accuracyCircle;
let myLocation = null;
let available = false;
let lastSentAt = null;
let wakeLock = null;

// ---------- Map (your original code) ----------
function initMap() {
  map = L.map("map").setView([-26.2041, 28.0473], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);
}

// ---------- GPS (your original code, but no more broadcast here) ----------
function updateGPS(position) {
  const { latitude, longitude, accuracy } = position.coords;
  myLocation = { latitude, longitude };

  document.getElementById("gpsStatus").textContent = "GPS: live";
  document.getElementById("locationText").textContent =
    `${latitude.toFixed(5)}, ${longitude.toFixed(5)} (±${Math.round(accuracy)}m)`;

  if (!myMarker) {
    myMarker = L.marker([latitude, longitude]).addTo(map).bindPopup("You — driver");
    accuracyCircle = L.circle([latitude, longitude], { radius: accuracy }).addTo(map);
    map.setView([latitude, longitude], 16);
  } else {
    myMarker.setLatLng([latitude, longitude]);
    accuracyCircle.setLatLng([latitude, longitude]).setRadius(accuracy);
  }
}

function gpsError(error) {
  document.getElementById("gpsStatus").textContent = "GPS: unavailable";
  document.getElementById("locationText").textContent =
    "Location permission required. Allow location for this app and try again.";
  console.warn(error);
}

// ---------- Connection status ----------
function setConn(ok) {
  const el = document.getElementById("connStatus");
  el.textContent = ok ? "Online" : "Connection lost";
  el.className = "pill " + (ok ? "ok" : "bad");
}

// ---------- Send location to Supabase ----------
// Location and availability are separate: we always send both values.
async function sendLocation() {
  if (!myLocation) return;
  const { error } = await db.from("driver_locations").upsert({
    driver_id: driverId,
    latitude: myLocation.latitude,
    longitude: myLocation.longitude,
    available: available,
    driver_name: profile ? profile.name : null,
    taxi_number: profile ? profile.taxi : null,
    vehicle: profile ? profile.vehicle : null,
    total_seats: profile ? profile.seats : null,
    updated_at: new Date().toISOString()
  });

  if (error) {
    console.warn(error);
    setConn(false);
    return;
  }
  setConn(true);
  lastSentAt = Date.now();
}

setInterval(() => { if (available) sendLocation(); }, SEND_EVERY_MS);

setInterval(() => {
  const el = document.getElementById("sentStatus");
  if (!available || !lastSentAt) { el.textContent = ""; return; }
  el.textContent = `Last sent ${Math.round((Date.now() - lastSentAt) / 1000)} seconds ago.`;
}, 1000);

// ---------- Keep the screen awake while available ----------
async function setAwake(on) {
  const el = document.getElementById("awakeStatus");
  try {
    if (on) {
      if (!("wakeLock" in navigator)) { el.textContent = "Screen-awake not supported here. Keep the screen on yourself."; return; }
      wakeLock = await navigator.wakeLock.request("screen");
      el.textContent = "Screen will stay on while you are available.";
    } else if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
      el.textContent = "";
    }
  } catch (e) {
    console.warn(e);
    el.textContent = "Could not keep the screen on. Keep the screen on yourself.";
  }
}

// The browser drops the lock when you leave and come back, so ask again.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && available) setAwake(true);
});

// ---------- Go available / offline ----------
const button = document.getElementById("availabilityBtn");
button.onclick = async () => {
  if (!available && !profile) {
    document.getElementById("driverStatus").textContent = "Add your taxi details first.";
    return;
  }
  if (!available && !myLocation) {
    document.getElementById("driverStatus").textContent = "Location permission required. Wait for GPS first.";
    return;
  }
  available = !available;

  if (available) {
    button.textContent = "GO OFFLINE";
    button.className = "offline";
    document.getElementById("driverStatus").textContent = "🟢 You are available. Passengers can see you.";
  } else {
    button.textContent = "GO AVAILABLE";
    button.className = "";
    document.getElementById("driverStatus").textContent = "🔴 You are offline.";
  }
  setAwake(available);
  await sendLocation();
};

window.addEventListener("online", () => sendLocation());
window.addEventListener("offline", () => setConn(false));

// ---------- Taxi details (saved on this phone, sent with your location) ----------
let profile = null;
try { profile = JSON.parse(localStorage.getItem("lr_driver_profile") || "null"); } catch (e) {}

function showProfile() {
  const has = !!profile;
  document.getElementById("profileView").style.display = has ? "block" : "none";
  document.getElementById("profileForm").style.display = has ? "none" : "block";
  if (has) {
    document.getElementById("profileSummary").textContent =
      `🚐 Taxi ${profile.taxi} · ${profile.vehicle} · ${profile.seats} seats · ${profile.name}`;
  }
}

document.getElementById("saveProfileBtn").onclick = () => {
  const name = document.getElementById("pfName").value.trim();
  const taxi = document.getElementById("pfTaxi").value.trim();
  const vehicle = document.getElementById("pfVehicle").value.trim();
  const seats = parseInt(document.getElementById("pfSeats").value, 10);
  const err = document.getElementById("profileError");

  if (!name || !taxi || !vehicle) { err.textContent = "Fill in your name, taxi number and vehicle."; return; }
  if (!Number.isInteger(seats) || seats < 1 || seats > 60) { err.textContent = "Total seats must be a number from 1 to 60."; return; }

  err.textContent = "";
  profile = { name, taxi, vehicle, seats };
  try { localStorage.setItem("lr_driver_profile", JSON.stringify(profile)); } catch (e) {}
  showProfile();
  if (available) sendLocation();
};

document.getElementById("editProfileBtn").onclick = () => {
  document.getElementById("pfName").value = profile.name;
  document.getElementById("pfTaxi").value = profile.taxi;
  document.getElementById("pfVehicle").value = profile.vehicle;
  document.getElementById("pfSeats").value = profile.seats;
  document.getElementById("profileView").style.display = "none";
  document.getElementById("profileForm").style.display = "block";
};

// ---------- Start ----------
initMap();
showProfile();
setConn(navigator.onLine);

if ("geolocation" in navigator) {
  navigator.geolocation.watchPosition(updateGPS, gpsError, {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 10000
  });
} else {
  gpsError({ message: "Geolocation not supported." });
}
