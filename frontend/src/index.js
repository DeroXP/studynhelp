import { createPanel } from './ui/panel.js';
import { mountChat } from './ui/chat.js';
import { mountAnalyzer } from './ui/analyzer.js';
import { mountCalculator } from './ui/calculator.js';
import { mountGraph } from './ui/graph.js';
import { mountScanner } from './ui/scanner.js';

export function bootstrap() {
  try {
    const panel = createPanel();
    document.body.appendChild(panel.root);
    mountChat(panel.views.viewChat);
    mountAnalyzer(panel.views.viewAnalyze);
    mountCalculator(panel.views.viewCalc);
    mountGraph(panel.views.viewGraph);
    mountScanner(panel.views.viewScan);
    // Developer diagnostics
    panel.views.viewDev.textContent = 'Diagnostics: Open console for logs. Use localStorage snhelp_api_base to set backend.';
    return true;
  } catch (e) {
    console.error('Failed to bootstrap StudyNHelp:', e);
    alert('Failed to load assistant. You can still use the page normally.');
    return false;
  }
}

// Attach global for console usage
if (typeof window !== 'undefined') {
  window.StudyNHelpBootstrap = bootstrap;
}
