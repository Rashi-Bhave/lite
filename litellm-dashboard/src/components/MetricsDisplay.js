import React, { useState, useEffect, useRef } from 'react';
import './MetricsDisplay.css';
import { FaChartLine } from 'react-icons/fa';

const MetricsDisplay = ({ metrics }) => {
  const formatTime = (timestamp) => {
    if (!timestamp) return '--';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
  };

  return (
    <div className="metrics-display">
      <h3><FaChartLine /> Latency Metrics</h3>
      <div className="metrics">
        <div className="metric">
          <span className="metric-label">Start Time:</span>
          <span className="metric-value">{formatTime(metrics.startTime)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">First Token:</span>
          <span className="metric-value">{formatTime(metrics.firstTokenTime)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">End Time:</span>
          <span className="metric-value">{formatTime(metrics.endTime)}</span>
        </div>
        <div className="metric highlight">
          <span className="metric-label">Time to First Token:</span>
          <span className="metric-value">{metrics.ttft ? `${metrics.ttft} ms` : '--'}</span>
        </div>
        <div className="metric highlight">
          <span className="metric-label">Generation Time:</span>
          <span className="metric-value">{metrics.generationTime ? `${metrics.generationTime} ms` : '--'}</span>
        </div>
        <div className="metric highlight">
          <span className="metric-label">Total Time:</span>
          <span className="metric-value">{metrics.totalTime ? `${metrics.totalTime} ms` : '--'}</span>
        </div>
      </div>
      
      <div className="tokens-section">
        <h4>Token Usage</h4>
        <div className="metric token">
          <span className="metric-label">Prompt Tokens:</span>
          <span className="metric-value">{metrics.promptTokens ?? '--'}</span>
        </div>
        <div className="metric token">
          <span className="metric-label">Completion Tokens:</span>
          <span className="metric-value">{metrics.completionTokens ?? '--'}</span>
        </div>
        <div className="metric token highlight">
          <span className="metric-label">Total Tokens:</span>
          <span className="metric-value">{metrics.totalTokens ?? '--'}</span>
        </div>
      </div>
    </div>
  );
};

export default MetricsDisplay;