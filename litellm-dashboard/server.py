from flask import Flask, request, jsonify
import requests
import time
import json
from datetime import datetime
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route('/proxy-chat', methods=['POST'])
def proxy_chat():
    """
    Proxy the chat completion request to LiteLLM and measure latency metrics
    """
    data = request.json
    url = "http://3.110.176.254:4000/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": request.headers.get('Authorization', '')
    }
    
    # If not streaming, make regular request and return with metrics
    if not data.get('stream', False):
        start_time = time.time()
        start_ms = int(start_time * 1000)
        
        response = requests.post(url, headers=headers, json=data)
        
        end_time = time.time()
        end_ms = int(end_time * 1000)
        total_time_ms = end_ms - start_ms
        
        # Return both the API response and timing metrics
        result = response.json()
        result['metrics'] = {
            'start_time': start_ms,
            'end_time': end_ms,
            'total_time': total_time_ms,
            'ttft': total_time_ms,  # For non-streaming, ttft = total time
            'generation_time': 0
        }
        
        return jsonify(result)
    
    # For streaming requests, we need to stream the response
    # and collect metrics along the way
    def generate():
        start_time = time.time()
        start_ms = int(start_time * 1000)
        first_token_received = False
        first_token_ms = None
        last_token_ms = None
        
        # Initialize with start time
        yield json.dumps({
            'event': 'metrics',
            'data': {
                'start_time': start_ms
            }
        }) + '\n\n'
        
        response = requests.post(url, headers=headers, json=data, stream=True)
        
        for line in response.iter_lines():
            if line:
                current_time = time.time()
                current_ms = int(current_time * 1000)
                decoded_line = line.decode('utf-8')
                
                # Forward the original data
                yield decoded_line + '\n\n'
                
                if decoded_line.startswith("data: ") and decoded_line != "data: [DONE]":
                    try:
                        json_str = decoded_line[6:]  # Remove "data: " prefix
                        token_data = json.loads(json_str)
                        
                        # Check if this contains actual content
                        if "choices" in token_data and token_data["choices"] and "delta" in token_data["choices"][0]:
                            delta = token_data["choices"][0]["delta"]
                            
                            if "content" in delta and delta["content"]:
                                if not first_token_received:
                                    first_token_received = True
                                    first_token_ms = current_ms
                                    ttft_ms = first_token_ms - start_ms
                                    
                                    # Send first token metric
                                    yield json.dumps({
                                        'event': 'metrics',
                                        'data': {
                                            'first_token_time': first_token_ms,
                                            'ttft': ttft_ms
                                        }
                                    }) + '\n\n'
                                
                                last_token_ms = current_ms
                                
                    except json.JSONDecodeError:
                        pass
                    
                elif decoded_line == "data: [DONE]":
                    end_ms = current_ms
                    total_time_ms = end_ms - start_ms
                    
                    # Calculate metrics
                    generation_time_ms = 0
                    if first_token_ms and last_token_ms:
                        generation_time_ms = last_token_ms - first_token_ms
                    
                    # Send final metrics
                    yield json.dumps({
                        'event': 'metrics',
                        'data': {
                            'end_time': end_ms,
                            'total_time': total_time_ms,
                            'generation_time': generation_time_ms
                        }
                    }) + '\n\n'
    
    return app.response_class(generate(), mimetype='text/event-stream')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)