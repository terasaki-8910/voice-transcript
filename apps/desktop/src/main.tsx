import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./theme/ThemeContext";
import { DisplayPreferencesProvider } from "./features/preferences/DisplayPreferencesContext";
import { VoiceInputSettingsProvider } from "./features/preferences/VoiceInputSettingsContext";
import { I18nProvider } from "./i18n/I18nContext";
import "./styles/global.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found");
}

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <DisplayPreferencesProvider>
          <VoiceInputSettingsProvider>
            <App />
          </VoiceInputSettingsProvider>
        </DisplayPreferencesProvider>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
);
