import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { AlertCircle, CheckCircle, Clock, Cpu, Database, MessageSquare, RotateCw, Zap } from 'lucide-react';

// Model lists from your config
const MODEL_OPTIONS = {
  "OpenAI": [
    { name: "GPT-4o", value: "openai/gpt-4o" },
    { name: "GPT-4.1", value: "openai/gpt-4.1" },
    { name: "GPT-4o mini", value: "openai/gpt-4o-mini" },
    { name: "o3", value: "openai/o3" },
    { name: "o3-mini", value: "openai/o3-mini" },
  ],
  "Gemini": [
    { name: "Gemini 1.5 Pro", value: "gemini/gemini-1.5-pro" },
    { name: "Gemini 1.5 Flash", value: "gemini/gemini-1.5-flash" },
    { name: "Gemini 2.0 Flash", value: "gemini/gemini-2.0-flash" },
    { name: "Gemini 2.5 Pro", value: "gemini/gemini-2.5-pro-preview-05-06" },
  ],
  "Anthropic": [
    { name: "Claude 3 Opus", value: "anthropic/claude-3-opus-20240229" },
    { name: "Claude 3 Sonnet", value: "anthropic/claude-3-sonnet-20240229" },
    { name: "Claude 3 Haiku", value: "anthropic/claude-3-haiku-20240307" },
  ],
  "Azure": [
    { name: "GPT-35 Turbo", value: "gpt-35-turbo" },
    { name: "GPT-4o", value: "gpt-4o" },
  ]
};

// Dashboard component
export default function LiteLLMDashboard() {
  const [selectedProvider, setSelectedProvider] = useState("OpenAI");
  const [selectedModel, setSelectedModel] = useState(MODEL_OPTIONS["OpenAI"][0].value);
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingComplete, setStreamingComplete] = useState(false);
  const [error, setError] = useState(null);
  const [stream, setStream] = useState(true);
  
  // Metrics
  const [metrics, setMetrics] = useState({
    ttft: null,
    totalTime: null,
    generationTime: null,
    inputTokens: null,
    outputTokens: null,
    startTime: null,
    firstTokenTime: null,
    endTime: null,
    fallbackInfo: null,
    modelUsed: null,
  });
  
  // Performance history
  const [performanceHistory, setPerformanceHistory] = useState([]);
  const responseRef = useRef(null);
  
  // Handle provider change
  const handleProviderChange = (e) => {
    const provider = e.target.value;
    setSelectedProvider(provider);
    setSelectedModel(MODEL_OPTIONS[provider][0].value);
  };
  
  // Handle model change
  const handleModelChange = (e) => {
    setSelectedModel(e.target.value);
  };
  
  // Send message to LiteLLM
  const sendMessage = async () => {
    if (!message.trim()) return;
    
    setIsLoading(true);
    setResponse("");
    setError(null);
    setStreamingComplete(false);
    
    // Reset metrics
    setMetrics({
      ttft: null,
      totalTime: null,
      generationTime: null,
      inputTokens: null,
      outputTokens: null,
      startTime: null,
      firstTokenTime: null,
      endTime: null,
      fallbackInfo: null,
      modelUsed: null,
    });
    
    const startTime = Date.now();
    setMetrics(prev => ({ ...prev, startTime }));
    
    try {
      const response = await fetch("http://localhost:4000/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer sk-Nurix123"
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [{ role: "user", content: message }],
          stream: stream
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error.message || "Error calling LiteLLM");
      }
      
      if (stream) {
        // Handle streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let responseText = "";
        let firstTokenReceived = false;
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");
          
          for (const line of lines) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try {
                const jsonStr = line.substring(6);
                const data = JSON.parse(jsonStr);
                
                // Extract model information
                if (!metrics.modelUsed && data.model) {
                  setMetrics(prev => ({ ...prev, modelUsed: data.model }));
                }
                
                // Check for fallback information in headers
                if (data.headers && data.headers["x-litellm-model-id"]) {
                  setMetrics(prev => ({ 
                    ...prev, 
                    fallbackInfo: `Fallback to: ${data.headers["x-litellm-model-id"]}` 
                  }));
                }
                
                // Check for content in the response
                if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
                  const content = data.choices[0].delta.content;
                  responseText += content;
                  setResponse(responseText);
                  
                  // Record first token time
                  if (!firstTokenReceived) {
                    const firstTokenTime = Date.now();
                    const ttft = firstTokenTime - startTime;
                    setMetrics(prev => ({ 
                      ...prev, 
                      ttft,
                      firstTokenTime
                    }));
                    firstTokenReceived = true;
                  }
                }
                
                // Record usage statistics if available
                if (data.usage) {
                  setMetrics(prev => ({ 
                    ...prev, 
                    inputTokens: data.usage.prompt_tokens,
                    outputTokens: data.usage.completion_tokens
                  }));
                }
              } catch (e) {
                // Ignore parsing errors for partial chunks
              }
            } else if (line === "data: [DONE]") {
              const endTime = Date.now();
              const totalTime = endTime - startTime;
              let generationTime = 0;
              
              if (metrics.firstTokenTime) {
                generationTime = endTime - metrics.firstTokenTime;
              }
              
              setMetrics(prev => ({ 
                ...prev, 
                endTime,
                totalTime,
                generationTime
              }));
              
              setStreamingComplete(true);
              
              // Add to history
              setPerformanceHistory(prev => {
                const newData = [
                  ...prev, 
                  {
                    name: new Date().toLocaleTimeString(),
                    ttft: metrics.ttft || 0,
                    total: totalTime,
                    model: selectedModel.split('/').pop()
                  }
                ];
                // Keep only last 10 entries
                return newData.slice(-10);
              });
              
              break;
            }
          }
        }
      } else {
        // Handle non-streaming response
        const data = await response.json();
        setResponse(data.choices[0].message.content);
        
        const endTime = Date.now();
        const totalTime = endTime - startTime;
        
        setMetrics({
          ttft: totalTime, // For non-streaming, TTFT equals total time
          totalTime,
          generationTime: totalTime,
          inputTokens: data.usage?.prompt_tokens,
          outputTokens: data.usage?.completion_tokens,
          startTime,
          firstTokenTime: startTime,
          endTime,
          modelUsed: data.model,
          fallbackInfo: null,
        });
        
        setStreamingComplete(true);
        
        // Add to history
        setPerformanceHistory(prev => {
          const newData = [
            ...prev, 
            {
              name: new Date().toLocaleTimeString(),
              ttft: totalTime,
              total: totalTime,
              model: selectedModel.split('/').pop()
            }
          ];
          // Keep only last 10 entries
          return newData.slice(-10);
        });
      }
    } catch (err) {
      setError(err.message);
      
      const endTime = Date.now();
      setMetrics(prev => ({ 
        ...prev, 
        endTime,
        totalTime: endTime - startTime
      }));
      
      // If there's a specific mention of fallback in the error
      if (err.message.includes("fallback")) {
        const fallbackMatch = err.message.match(/fallback to: ([^,\s]+)/i);
        if (fallbackMatch) {
          setMetrics(prev => ({ 
            ...prev, 
            fallbackInfo: `Attempted fallback to: ${fallbackMatch[1]}`
          }));
        }
      }
    } finally {
      setIsLoading(false);
    }
  };
  
  // Scroll to bottom of response when it updates
  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [response]);
  
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 py-4">
        <div className="container mx-auto px-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Database className="h-5 w-5 text-blue-600" /> LiteLLM Monitoring Dashboard
          </h1>
          <div className="flex items-center space-x-2">
            <span className="px-3 py-1 rounded-full bg-green-100 text-green-800 text-xs font-medium">
              Connected to port 4000
            </span>
          </div>
        </div>
      </header>
      
      {/* Main Content */}
      <div className="flex-1 container mx-auto p-4 flex flex-col md:flex-row gap-4 overflow-hidden">
        {/* Left Panel - Controls */}
        <div className="w-full md:w-1/3 flex flex-col gap-4">
          {/* Model Selection */}
          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
            <h2 className="text-lg font-semibold text-gray-700 mb-3">Model Selection</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
                <select 
                  className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={selectedProvider}
                  onChange={handleProviderChange}
                >
                  {Object.keys(MODEL_OPTIONS).map(provider => (
                    <option key={provider} value={provider}>{provider}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
                <select 
                  className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={selectedModel}
                  onChange={handleModelChange}
                >
                  {MODEL_OPTIONS[selectedProvider].map(model => (
                    <option key={model.value} value={model.value}>{model.name}</option>
                  ))}
                </select>
              </div>
              
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="stream"
                  checked={stream}
                  onChange={(e) => setStream(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="stream" className="text-sm text-gray-700">Stream response</label>
              </div>
            </div>
          </div>
          
          {/* Metrics */}
          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex-1">
            <h2 className="text-lg font-semibold text-gray-700 mb-3">Performance Metrics</h2>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-blue-50 rounded-lg">
                <div className="text-xs text-blue-600 font-medium">TTFT</div>
                <div className="text-lg font-semibold flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {metrics.ttft ? `${metrics.ttft} ms` : '-'}
                </div>
              </div>
              
              <div className="p-3 bg-purple-50 rounded-lg">
                <div className="text-xs text-purple-600 font-medium">Total Time</div>
                <div className="text-lg font-semibold flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {metrics.totalTime ? `${metrics.totalTime} ms` : '-'}
                </div>
              </div>
              
              <div className="p-3 bg-green-50 rounded-lg">
                <div className="text-xs text-green-600 font-medium">Input Tokens</div>
                <div className="text-lg font-semibold flex items-center gap-1">
                  <MessageSquare className="h-4 w-4" />
                  {metrics.inputTokens || '-'}
                </div>
              </div>
              
              <div className="p-3 bg-yellow-50 rounded-lg">
                <div className="text-xs text-yellow-600 font-medium">Output Tokens</div>
                <div className="text-lg font-semibold flex items-center gap-1">
                  <MessageSquare className="h-4 w-4" />
                  {metrics.outputTokens || '-'}
                </div>
              </div>
            </div>
            
            {/* Model Info */}
            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-500 font-medium">MODEL USED</div>
              <div className="text-sm font-semibold mt-1">{metrics.modelUsed || selectedModel}</div>
              
              {metrics.fallbackInfo && (
                <div className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                  <RotateCw className="h-3 w-3" />
                  {metrics.fallbackInfo}
                </div>
              )}
            </div>
            
            {/* Performance Graph */}
            <div className="mt-4 h-40">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Recent Performance</h3>
              {performanceHistory.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={performanceHistory}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{fontSize: 10}} height={15} />
                    <YAxis tick={{fontSize: 10}} width={30} />
                    <Tooltip />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="ttft" 
                      name="TTFT" 
                      stroke="#3b82f6" 
                      strokeWidth={2} 
                      dot={false} 
                    />
                    <Line 
                      type="monotone" 
                      dataKey="total" 
                      name="Total" 
                      stroke="#8b5cf6" 
                      strokeWidth={2} 
                      dot={false} 
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                  No data yet
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Right Panel - Chat */}
        <div className="w-full md:w-2/3 flex flex-col gap-4">
          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-col flex-1 overflow-hidden">
            <h2 className="text-lg font-semibold text-gray-700 mb-3">Chat Interface</h2>
            
            {/* Response Area */}
            <div 
              ref={responseRef}
              className="flex-1 p-4 bg-gray-50 rounded-lg overflow-y-auto mb-4"
            >
              {error ? (
                <div className="p-3 bg-red-50 text-red-700 rounded-lg flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold mb-1">Error</div>
                    <div className="text-sm whitespace-pre-wrap">{error}</div>
                  </div>
                </div>
              ) : response ? (
                <div className="space-y-4">
                  <div className="p-3 bg-blue-50 text-blue-800 rounded-lg">
                    <div className="font-semibold mb-1">User</div>
                    <div className="text-sm">{message}</div>
                  </div>
                  
                  <div className="p-3 bg-gray-100 text-gray-800 rounded-lg">
                    <div className="font-semibold mb-1 flex items-center justify-between">
                      <div>Assistant ({metrics.modelUsed || selectedModel.split('/').pop()})</div>
                      {streamingComplete && (
                        <span className="flex items-center text-xs text-green-600 font-normal gap-1">
                          <CheckCircle className="h-3 w-3" />
                          Complete
                        </span>
                      )}
                    </div>
                    <div className="text-sm whitespace-pre-wrap">{response}</div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400">
                  {isLoading ? (
                    <div className="flex flex-col items-center">
                      <svg className="animate-spin h-5 w-5 mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Generating response...</span>
                    </div>
                  ) : (
                    "Send a message to see the response"
                  )}
                </div>
              )}
            </div>
            
            {/* Input Area */}
            <div className="flex gap-2">
              <textarea 
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your message here..."
                className="flex-1 p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={3}
                disabled={isLoading}
              />
              <button
                onClick={sendMessage}
                disabled={isLoading || !message.trim()}
                className={`px-4 py-2 rounded-md font-medium focus:outline-none ${
                  isLoading || !message.trim() 
                    ? 'bg-gray-200 text-gray-500 cursor-not-allowed' 
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processing
                  </span>
                ) : 'Send'}
              </button>
            </div>
          </div>
          
          {/* Status Panel */}
          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-semibold text-gray-700">System Status</h2>
              
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 text-xs">
                  <div className="h-2 w-2 rounded-full bg-green-500"></div>
                  <span className="text-gray-600">LiteLLM API</span>
                </div>
                
                <div className="flex items-center gap-1 text-xs">
                  <div className={`h-2 w-2 rounded-full ${selectedModel.includes('azure') ? 'bg-green-500' : 'bg-blue-500'}`}></div>
                  <span className="text-gray-600">{selectedProvider}</span>
                </div>
                
                <div className="flex items-center gap-1 text-xs">
                  <div className={`h-2 w-2 rounded-full ${error ? 'bg-red-500' : 'bg-gray-300'}`}></div>
                  <span className="text-gray-600">Fallbacks</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}