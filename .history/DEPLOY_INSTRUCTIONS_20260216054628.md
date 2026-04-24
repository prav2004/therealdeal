# Deployment Instructions

## Step 1: Deploy Backend to Cloud Run

Open PowerShell and navigate to the project folder:
```powershell
cd "c:\Users\pravn\Downloads\pickr_app_login_working\pickr_app_login_working\pickr_app_finals"
```

Build and deploy the backend:
```powershell
gcloud builds submit --tag us-central1-docker.pkg.dev/pickr-d4d9b/pickr-repo/pickr-backend
gcloud run deploy pickr-backend --image us-central1-docker.pkg.dev/pickr-d4d9b/pickr-repo/pickr-backend --platform managed --region us-central1 --allow-unauthenticated --set-env-vars SPORTSDATAIO_KEY=YOUR_KEY_HERE
```

## Step 2: Deploy Frontend to Firebase Hosting

```powershell
firebase deploy --only hosting
```

## Step 3: Test

Visit https://pickr-d4d9b.web.app/login.html and press Ctrl+Shift+R to hard refresh.

Check the browser console (F12) for any errors.
