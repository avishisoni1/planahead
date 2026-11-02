# PlanAhead

Tell it when and where you need to be. PlanAhead adds your prep steps, travel time and a buffer, then works backwards to tell you when to start getting ready and when to leave.

Mobile-first web app for India. No build step, no account, no paid APIs. Installable on phones (Add to Home Screen).

## Features
- **Plan a trip:** reach-by time, from/to (India-only search), and every travel option calculated automatically: Metro, Cab, Auto, Bike, Bus, Walk. The fastest one is marked.
- **Metro journeys:** pick from 18 Indian metro networks (Delhi NCR, Mumbai, Bengaluru, Chennai, Hyderabad, Kolkata, Kochi, Lucknow, Jaipur, Ahmedabad, Surat, Pune, Nagpur, Kanpur, Agra, Bhopal, Indore, Patna, Meerut). The nearest stations are chosen for you, and you can change them. Shows lines, stops and interchanges, and calculates door to door: walk/auto to the station → metro → walk/auto/cab to the destination.
- **Daily trips:** save college, office or gym with weekdays, then plan them in one tap. Home shows the next date for each.
- **Occasional trips:** templates for interview, exam, flight, train, wedding/party and doctor, with sensible prep and buffers.
- **Plan again:** recent trips repeat with one tap.
- **Live mode:** countdown for each step, "running late" warnings, road travel rechecked every 12 min in the 2 hours before leaving, notifications, and a calendar file with alarms.
- **Learns your habits:** real step durations feed "You usually take 22 min" suggestions. On-time rate is shown on Home.

## Describe your plan (AI, free)
Type a plan in plain words (English or Hinglish), e.g. *"Interview at DLF Cyber Hub tomorrow 11am, bath and breakfast first, by metro"*. The app fills in the trip and shows what to double-check.

**Gemini runs only on your backend. Users never see or enter a key.** The phone sends just the sentence and its date/time to `/api/parse`. The server adds the fixed prompt and schema (`api/_gemini.json`) and calls Gemini with your key, so the endpoint can't be used as a free general chatbot. It allows 10 requests per minute per user.

Where the key goes:
- **On your computer:** paste it into `.env.local` (next to `serve.ps1`, outside the app folder, so it's never served). No restart needed. The server window says whether AI is on.
- **When hosted on Vercel:** Project → Settings → Environment Variables → `GEMINI_API_KEY`, then redeploy.

If there's no key, or Gemini is busy or fails, the **built-in reader** fills the plan in instead (offline, free). It understands times (11am, 9 baje), dates (tomorrow, kal, Friday, 5 Nov), modes, buffers, common steps, and places.

Free-tier note: Google may use free-tier prompts to improve its products, so Settings tells users to avoid personal details.

## Traffic (free)
Cab, auto and bike times come from **TomTom's free Routing API** through `/api/traffic` (key on the server only):
- **When you plan:** TomTom predicts traffic for your arrival time (e.g. Monday 10:00) from historical speeds on each road for that weekday and hour. The app shows "Traffic predicted for Mon morning".
- **On the day:** in the 2 hours before leaving, road trips are rechecked every 12 min with live traffic, and you get an alert if your leave time moves.
- **Learns from you:** after "I've left" → "I've reached", the app compares the real time with the prediction for that route and hour, and adjusts future trips (labelled "learned").
- **Fallback:** with no key, or if TomTom is down or over its limit, it uses usual Indian city traffic for that hour.
- **Staying free:** one request covers cab, auto and bike, answers are cached per 5-minute slot, metro and walking never call it, and live rechecks only run for road trips. TomTom's free tier is about 2,500 requests a day.

Key: get a free key at developer.tomtom.com (no card). Put it in `.env.local` as `TOMTOM_API_KEY=...` locally, and in Vercel's Environment Variables when hosted.

## Where the data comes from (all free)
| What | Source |
|---|---|
| Place search (India only) | Photon / OpenStreetMap |
| Current location → address | Nominatim / OpenStreetMap |
| Cab, auto, bike times | TomTom predicted/live traffic, else OSRM + usual Indian city traffic by hour |
| Walk times | OSRM (FOSSGIS servers) |
| Bus | Transitous timetables where available, else a labelled estimate |
| Metro lines & stations | Wikidata (CC0), bundled in `data/metro.json`, routed on the phone |

Metro time = 6 min entry/security/wait + ride time from station distances (~42 km/h incl. stops) + 5 min per interchange + 2 min exit. Checked against DMRC journey times (Rajiv Chowk → Noida City Centre: 32 min).

To refresh metro data (new stations/lines): `powershell -ExecutionPolicy Bypass -File tools\build-metro.ps1`

## Run on your computer
From the folder above `planahead`:
```
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```
Then open http://localhost:5174

## Put it online (free)
- **Vercel (recommended, enables shared Gemini):** put the `planahead` folder in a GitHub repo → vercel.com → Add New Project → import it (Framework: Other, no build command) → Settings → Environment Variables → `GEMINI_API_KEY` and `TOMTOM_API_KEY` → redeploy.
- **Netlify Drop (quickest):** drag the `planahead` folder onto app.netlify.com/drop. The server function doesn't run there, so users use the built-in reader or their own key.
- GitHub Pages and Cloudflare Pages work the same way as Netlify Drop.

It needs HTTPS for location, notifications and install, which all of these provide.

## Limits
- Predicted traffic is based on usual patterns, so festivals, rallies or heavy rain only show up in the live recheck on the day.
- Bus timetables only exist for some cities. Elsewhere the bus time is an estimate.
- Reminders fire while the app is open or installed. On iPhone, use "Add to calendar" for alarms.
- Trips are stored on the phone only.
