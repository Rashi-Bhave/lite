import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { FaCloud, FaRobot, FaClock, FaChartLine, FaHistory } from 'react-icons/fa';

function App() {
  const [selectedModelGroup, setSelectedModelGroup] = useState('openai');
  const [selectedModel, setSelectedModel] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [metrics, setMetrics] = useState({
    startTime: null,
    firstTokenTime: null,
    endTime: null,
    ttft: null,
    generationTime: null,
    totalTime: null
  });
  const [history, setHistory] = useState([]);
  const [isStreaming, setIsStreaming] = useState(true);
  const responseRef = useRef(null);

  // Model lists by provider
  const modelGroups = {
    openai: [
      'gpt-4.1', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1-nano',
      'gpt-4o-mini', 'o4-mini', 'o3', 'o3-mini', 'o1'
    ],
    gemini: [
      'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash',
      'gemini-2.5-pro-preview-05-06', 'gemini-2.5-flash-preview-04-17'
    ],
    azure: ['gpt-35-turbo', 'gpt-4o']
  };

  useEffect(() => {
    // Reset selected model when provider changes
    setSelectedModel('');
  }, [selectedModelGroup]);

  const formatTime = (timestamp) => {
    if (!timestamp) return '--';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!userPrompt.trim() || !selectedModel) return;

    // Reset states
    setResponse('');
    setIsLoading(true);
    setMetrics({
      startTime: Date.now(),
      firstTokenTime: null,
      endTime: null,
      ttft: null,
      generationTime: null,
      totalTime: null
    });

    try {
      const modelPrefix = selectedModelGroup === 'azure' ? '' : `${selectedModelGroup}/`;
      const modelName = `${modelPrefix}${selectedModel}`;
      
      const startMs = Date.now();
      
      // Prepare request
      const url = "http://13.127.145.5:4000/chat/completions";
      const headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer sk-Nurix123"
      };
      
      const data = {
        model: modelName,
        messages: [
          {
            role: "user",
            content: userPrompt
          }
        ],
        stream: isStreaming
      };

      let receivedFirstToken = false;
      let firstTokenMs = null;
      let responseText = '';
      let lastTokenTime = null;

      if (isStreaming) {
        // Handle streaming response
        const response = await fetch(url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(data)
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const jsonStr = line.substring(6); // Remove "data: " prefix
                const tokenData = JSON.parse(jsonStr);
                
                if (tokenData.choices && tokenData.choices[0]?.delta?.content) {
                  const tokenContent = tokenData.choices[0].delta.content;
                  const currentTime = Date.now();
                  
                  if (!receivedFirstToken) {
                    receivedFirstToken = true;
                    firstTokenMs = currentTime;
                    
                    setMetrics(prev => ({
                      ...prev,
                      firstTokenTime: currentTime,
                      ttft: currentTime - startMs
                    }));
                  }
                  
                  lastTokenTime = currentTime;
                  responseText += tokenContent;
                  setResponse(responseText);
                }
              } catch (e) {
                // Skip JSON parsing errors
              }
            } else if (line === 'data: [DONE]') {
              const endTime = Date.now();
              
              setMetrics(prev => ({
                ...prev,
                endTime: endTime,
                totalTime: endTime - startMs,
                generationTime: lastTokenTime ? (lastTokenTime - firstTokenMs) : null
              }));
            }
          }
        }
      } else {
        // Handle non-streaming response
        const response = await fetch(url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({...data, stream: false})
        });
        
        const result = await response.json();
        const firstTokenMs = Date.now();
        const endTime = Date.now();
        
        setMetrics(prev => ({
          ...prev,
          firstTokenTime: firstTokenMs,
          ttft: firstTokenMs - startMs,
          endTime: endTime,
          totalTime: endTime - startMs,
          generationTime: endTime - firstTokenMs
        }));
        
        if (result.choices && result.choices[0]?.message?.content) {
          responseText = result.choices[0].message.content;
          setResponse(responseText);
        } else if (result.error) {
          responseText = `Error: ${JSON.stringify(result.error)}`;
          setResponse(responseText);
        }
      }
      
      // Add to history
      setHistory(prev => [{
        id: Date.now(),
        model: modelName,
        prompt: userPrompt,
        response: responseText,
        metrics: {
          startTime: startMs,
          firstTokenTime: firstTokenMs,
          endTime: Date.now(),
          ttft: firstTokenMs ? (firstTokenMs - startMs) : null,
          generationTime: firstTokenMs && lastTokenTime ? (lastTokenTime - firstTokenMs) : null,
          totalTime: Date.now() - startMs
        }
      }, ...prev.slice(0, 9)]);  // Keep last 10 items
      
    } catch (error) {
      setResponse(`Error: ${error.message}`);
      setMetrics(prev => ({
        ...prev,
        endTime: Date.now(),
        totalTime: Date.now() - prev.startTime
      }));
    } finally {
      setIsLoading(false);

      // Scroll to bottom of response
      if (responseRef.current) {
        responseRef.current.scrollTop = responseRef.current.scrollHeight;
      }
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1><FaRobot /> LiteLLM Dashboard</h1>
        <div className="stream-toggle">
          <label>
            <input 
              type="checkbox" 
              checked={isStreaming} 
              onChange={() => setIsStreaming(!isStreaming)} 
            />
            Stream Response
          </label>
        </div>
      </header>

      <div className="main-content">
        <div className="sidebar">
          <div className="provider-selector">
            <h3><FaCloud /> Model Provider</h3>
            <div className="provider-buttons">
              {Object.keys(modelGroups).map(provider => (
                <button
                  key={provider}
                  className={selectedModelGroup === provider ? 'active' : ''}
                  onClick={() => setSelectedModelGroup(provider)}
                >
                  {provider.charAt(0).toUpperCase() + provider.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="model-selector">
            <h3>Select Model</h3>
            <div className="models-list">
              {modelGroups[selectedModelGroup].map(model => (
                <div 
                  key={model} 
                  className={`model-item ${selectedModel === model ? 'active' : ''}`}
                  onClick={() => setSelectedModel(model)}
                >
                  {model}
                </div>
              ))}
            </div>
          </div>

          <div className="metrics-panel">
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
                <span className="metric-label">Total Time:</span>
                <span className="metric-value">{metrics.totalTime ? `${metrics.totalTime} ms` : '--'}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="content">
          <form onSubmit={handleSubmit} className="prompt-form">
            <textarea
              className="prompt-input"
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              placeholder="Enter your prompt..."
              disabled={isLoading}
            />
            <button 
              type="submit" 
              className="submit-button" 
              disabled={isLoading || !selectedModel}
            >
              {isLoading ? 'Processing...' : 'Send'}
            </button>
          </form>

          <div className="response-container" ref={responseRef}>
            <h3>Response</h3>
            <div className="model-info">
              {selectedModel && (
                <span>Using: {selectedModelGroup}/{selectedModel}</span>
              )}
            </div>
            {isLoading && !response && (
              <div className="loading">
                <div className="loading-spinner"></div>
                <span>Waiting for response...</span>
              </div>
            )}
            <div className="response-content">
              {response ? response : <span className="placeholder">Response will appear here</span>}
            </div>
          </div>
        </div>

        <div className="history-panel">
          <h3><FaHistory /> History</h3>
          <div className="history-list">
            {history.length === 0 ? (
              <div className="empty-history">No history yet</div>
            ) : (
              history.map(item => (
                <div key={item.id} className="history-item">
                  <div className="history-header">
                    <span className="history-model">{item.model}</span>
                    <span className="history-time">{new Date(item.metrics.startTime).toLocaleTimeString()}</span>
                  </div>
                  <div className="history-prompt">{item.prompt.length > 50 ? `${item.prompt.substring(0, 50)}...` : item.prompt}</div>
                  <div className="history-metrics">
                    <span>TTFT: {item.metrics.ttft ? `${item.metrics.ttft} ms` : '--'}</span>
                    <span>Total: {item.metrics.totalTime} ms</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;