I will implement the Google Cloud Text-to-Speech API integration by adding it as a provider in the backend server functions and updating the frontend to support Google's high-quality Neural2 and Studio voices.

### User Review Required

> [!IMPORTANT]
> This integration requires a **Google Cloud Service Account JSON Key** to be added as an environment variable `GOOGLE_APPLICATION_CREDENTIALS` in the Lovable project settings.
>
> I will also add a `GOOGLE_CLOUD_PROJECT_ID` variable to specify the target project.

### Technical Details

#### 1. Backend Integration (Server Functions)
- Update `src/lib/ai-script.functions.ts` to add a new `google` provider in the `generateProTTS` function.
- Implement the call to the Google Cloud TTS API using `fetch`.
- Support high-quality voices (`Neural2`, `Studio`) by mapping them in the request.
- Pass `speakingRate` and `pitch` parameters to the API as requested.
- Ensure proper error handling and return audio in Base64 format.

#### 2. Frontend Configuration (Presentation Settings)
- Update `src/components/ai-presenter-tab.tsx` to include "Google Cloud" as a Pro TTS provider.
- Update the voice selection logic to fetch and display Google's `Neural2` and `Studio` voices for `pt-BR`.
- Add a `pitch` slider to the UI to control the tone, alongside the existing speed slider.

#### 3. Execution Logic (Playback)
- Update `src/routes/-present.$id.component.tsx` to handle the new Google TTS audio.
- The system will attempt to use Google TTS if configured; if it fails (due to a missing key or API error), it will automatically fall back to the browser's native `SpeechSynthesis`.

#### 4. Environment Variables
- `GOOGLE_APPLICATION_CREDENTIALS`: The full JSON key from Google Cloud.
- `GOOGLE_CLOUD_PROJECT_ID`: The ID of your Google Cloud project.
