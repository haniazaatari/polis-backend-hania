import React from "react";

const TopicAgendaStyles = () => (
  <style jsx>{`
    .topic-agenda {
      padding: 20px;
      max-width: 1200px;
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .header {
      text-align: center;
      margin-bottom: 30px;
    }

    .header h1 {
      margin: 0 0 10px 0;
      color: #333;
      font-size: 2.2rem;
    }

    .subtitle {
      color: #666;
      font-size: 1.1rem;
      margin: 0;
      max-width: 600px;
      margin: 0 auto;
    }

    .controls {
      background: white;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .progress h3 {
      margin: 0 0 10px 0;
      color: #333;
    }

    .progress-text {
      color: #666;
      margin-bottom: 15px;
      font-size: 1rem;
    }

    .progress-bar {
      width: 100%;
      height: 8px;
      background: #e9ecef;
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 20px;
    }

    .progress-fill {
      height: 100%;
      background: #03a9f4;
      transition: width 0.3s ease;
    }

    .control-buttons {
      display: flex;
      gap: 10px;
    }

    .reset-button, .export-button, .submit-button, .restart-button {
      padding: 10px 20px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
    }

    .reset-button, .restart-button {
      background: #6c757d;
      color: white;
    }

    .reset-button:disabled {
      background: #bbb;
      cursor: not-allowed;
      opacity: 0.6;
    }

    .export-button {
      background: #007bff;
      color: white;
    }

    .submit-button {
      background: #28a745;
      color: white;
      font-size: 1.1rem;
      padding: 15px 30px;
      margin-right: 15px;
    }

    .completion-screen {
      text-align: center;
      padding: 40px 20px;
    }

    .completion-header h1 {
      color: #28a745;
      margin-bottom: 15px;
    }

    .completion-summary {
      color: #666;
      font-size: 1.1rem;
      margin-bottom: 30px;
    }

    .completion-actions {
      margin: 30px 0;
    }

    .final-agenda-summary {
      margin-top: 40px;
      text-align: left;
    }

    .distant-topics-divider {
      grid-column: 1 / -1;
      margin: 30px 0 20px 0;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 6px;
      border-left: 4px solid #6c757d;
    }

    .distant-topics-divider h3 {
      margin: 0;
      color: #6c757d;
      font-size: 1.1rem;
      font-weight: 500;
    }

    .banked-topics {
      margin-bottom: 20px;
    }

    .banked-topics h3 {
      margin: 0 0 15px 0;
      color: #333;
    }

    .banked-layer {
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 10px;
      border: 1px solid #dee2e6;
    }

    .banked-layer h4 {
      margin: 0 0 10px 0;
      color: #495057;
      font-size: 1rem;
    }

    .banked-topics-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 8px;
    }

    .banked-topic {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px;
      background: rgba(255,255,255,0.7);
      border-radius: 4px;
      font-size: 0.9rem;
    }

    .current-layer {
      padding: 20px;
      margin-bottom: 20px;
    }

    .layer-header {
      margin-bottom: 20px;
    }

    .step-section {
      margin-bottom: 15px;
    }

    .progress-bar-inline {
      display: inline-block;
      width: 80px;
      height: 6px;
      background: #e9ecef;
      border-radius: 3px;
      overflow: hidden;
      margin-left: 10px;
      vertical-align: middle;
    }

    .call-to-action {
      color: #555;
      font-size: 1rem;
      margin: 10px 0 15px 0;
      line-height: 1.4;
    }

    .selection-status {
      color: #666;
      font-size: 0.9rem;
      margin-bottom: 15px;
      font-weight: 500;
    }

    .layer-header h1 {
      margin: 0 0 12px 0;
      color: #333;
      font-size: 1.5rem;
      font-weight: 600;
    }

    .layer-header h2 {
      margin: 0 0 8px 0;
      color: #333;
      font-size: 1.2rem;
    }

    .layer-subtitle {
      color: #666;
      font-size: 0.95rem;
      margin-bottom: 15px;
    }

    .button-group {
      display: flex;
      gap: 15px;
      align-items: flex-end;
    }

    .step-and-button {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .step-and-button h2 {
      margin: 0;
    }

    .selection-count {
      font-weight: 300;
      font-style: italic;
    }

    .action-buttons {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .bank-button, .submit-finish-button {
      border: none;
      padding: 12px 24px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 1rem;
    }

    .bank-button {
      background: #03a9f4;
      color: white;
    }

    .bank-button:hover:not(.disabled) {
      background: #0288d1;
    }

    .bank-button.disabled {
      background: #bbb;
      cursor: not-allowed;
      opacity: 0.6;
    }

    .submit-finish-button {
      background: #28a745;
      color: white;
    }

    .submit-finish-button:hover:not(.disabled) {
      background: #218838;
    }

    .submit-finish-button.disabled {
      background: #bbb;
      cursor: not-allowed;
      opacity: 0.6;
    }

    .topics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 10px;
    }

    .topic-item {
      background: white;
      border: 2px solid #e9ecef;
      border-radius: 6px;
      padding: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .topic-item:hover {
      border-color: #adb5bd;
      background: #f8f9fa;
    }

    .topic-item.selected.brick {
      border-color: #03a9f4;
      background: #e1f5fe;
      opacity: 1;
      transition: all 0.3s ease;
    }

    .topic-item.banked-brick {
      border-color: #03a9f4;
      background: #e1f5fe;
      opacity: 1;
      cursor: default;
    }

    .topic-content {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      width: 100%;
    }

    .topic-id {
      color: #6c757d;
      font-size: 0.8rem;
      font-weight: 600;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    }

    .topic-id-hidden {
      visibility: hidden;
      position: absolute;
      left: -9999px;
      color: #6c757d;
      font-size: 0.7rem;
      font-weight: 400;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    }

    .proximity-info-hidden {
      visibility: hidden;
      position: absolute;
      left: -9999px;
      color: #6c757d;
      font-size: 0.7rem;
      font-weight: 400;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    }

    .source-indicator {
      margin-left: 5px;
      font-size: 0.8rem;
    }

    .topic-checkbox {
      transform: scale(1.2);
      cursor: pointer;
    }

    .topic-text {
      color: #212529;
      font-size: 1rem;
      line-height: 1.3;
      font-weight: 500;
      flex: 1;
    }

    .no-data, .loading, .error-message {
      text-align: center;
      padding: 40px;
      background: white;
      border-radius: 8px;
      margin: 20px 0;
    }

    .error-message {
      background: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
    }

    /* Mobile responsiveness */
    @media (max-width: 768px) {
      .topic-agenda {
        padding: 15px;
      }
      
      .topics-grid, .banked-topics-list {
        grid-template-columns: 1fr;
      }
      
      .header h1 {
        font-size: 1.8rem;
      }
      
      .control-buttons {
        flex-direction: column;
      }
      
      .topic-header-row {
        flex-direction: column;
        align-items: flex-start;
        gap: 5px;
      }
    }
  `}</style>
);

export default TopicAgendaStyles;
