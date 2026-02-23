# 🎙️ Alexa Audio Debugging: Build Notifications

This guide outlines how to configure **SpotifyUnlocked** to "talk" to you via Alexa when builds pass or fail, using the **Notify Me** skill by Tomtronics.

## 🛠️ Infrastructure Setup

### 1. The Skill
*   Enable the **Notify Me** skill on your Amazon Alexa app.
*   Ask Alexa: *"Alexa, open Notify Me."*
*   She will provide you with a **unique Access Code**.
*   Save this code as a **GitHub Organizational Secret** named `ALEXA_NOTIFY_ME_TOKEN`.

### 2. Audio Differentiation Strategy
Since "Notify Me" sends notifications to your Echo (the yellow ring), we use **SSML-style text cues** or distinct keywords so you can hear the difference immediately when you ask Alexa for your notifications.

| State | Notification Message | Audio Experience |
| :--- | :--- | :--- |
| **SUCCESS** | "✅ Spotify Unlocked: The crate is full. Build Success." | Confident, upward tone |
| **FAILURE** | "❌ Spotify Unlocked: The crate is empty. Build Failed." | Urgent, downward tone |

---

## 💻 Technical Implementation (GitHub Actions)

Add these steps to the bottom of your `.github/workflows/deploy.yml` to trigger the notifications.

```yaml
      - name: Notify Success
        if: success()
        run: |
          curl -X POST "https://api.notifymyecho.com/v1/NotifyMe" \
          -H "Content-Type: application/json" \
          -d "{\"notification\": \"✅ Spotify Unlocked: The crate is full. Build Success.\", \"accessCode\": \"${{ secrets.ALEXA_NOTIFY_ME_TOKEN }}\"}"

      - name: Notify Failure
        if: failure()
        run: |
          curl -X POST "https://api.notifymyecho.com/v1/NotifyMe" \
          -H "Content-Type: application/json" \
          -d "{\"notification\": \"❌ Spotify Unlocked: The crate is empty. Build Failed.\", \"accessCode\": \"${{ secrets.ALEXA_NOTIFY_ME_TOKEN }}\"}"
```

---

## 🔊 Pro Level: Audio Routines
To get **distinct sounds** (like a buzzer for failure), use the **Alexa App Routines**:
1.  **Trigger:** When a notification from "Notify Me" contains the word "Failed".
2.  **Action:** Play sound "Buzzer" + Set volume to 8.

This turns your dev environment into a literal "Audio Studio" where you don't even have to look at your screen to know the pipeline status.
