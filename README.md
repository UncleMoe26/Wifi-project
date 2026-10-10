# Recharge Reminder

A simple phone app that reminds you to recharge your mobile line (Alfa, Touch or any carrier) before it expires, so you don't lose your number or your remaining balance.

## Features

- Add all your lines (yours, family members') with their expiry date.
- Color-coded countdown: green (fine), orange (recharge soon), red (expires today / expired).
- Reminder banners and phone notifications when a line is within your chosen number of days.
- **Add to calendar**: downloads a calendar event with alarms, so you get reminded even when the app is closed.
- **I recharged**: moves the expiry forward by the line's validity (30 days by default).
- Works offline and can be installed on the home screen. Data stays on your phone only.

## Run it

It's a static web app, no build step:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

To use it on your phone, host it with GitHub Pages: repo **Settings → Pages → Deploy from a branch → `main` / root**. Open the Pages link on your phone and choose **Add to Home Screen**.
