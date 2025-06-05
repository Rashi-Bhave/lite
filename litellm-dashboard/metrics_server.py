from flask import Flask, request, jsonify
from flask_cors import CORS
import time
import json
import requests
import logging
from datetime import datetime
import pandas as pd
import matplotlib.pyplot as plt
import io
import base64

app = Flask(__name__)
CORS(app)
logging.basicConfig(level=logging.INFO)

# Store metrics history
metrics_history = []

@app.route('/metrics', methods=['GET'])
def get_metrics():
    """Return stored metrics history"""
    return jsonify(metrics_history)

@app.route('/metrics/stats', methods=['GET'])
def get_metrics_stats():
    """Return statistical analysis of metrics"""
    if not metrics_history:
        return jsonify({"error": "No metrics data available"})
    
    df = pd.DataFrame(metrics_history)
    
    stats = {
        "models": df['model'].value_counts().to_dict(),
        "ttft": {
            "mean": df['ttft'].mean(),
            "median": df['ttft'].median(),
            "min": df['ttft'].min(),
            "max": df['ttft'].max()
        },
        "total_time": {
            "mean": df['total_time'].mean(),
            "median": df['total_time'].median(),
            "min": df['total_time'].min(),
            "max": df['total_time'].max()
        },
        "by_model": {}
    }
    
    # Group by model
    for model in df['model'].unique():
        model_df = df[df['model'] == model]
        stats["by_model"][model] = {
            "ttft": {
                "mean": model_df['ttft'].mean(),
                "median": model_df['ttft'].median(),
                "min": model_df['ttft'].min(),
                "max": model_df['ttft'].max()
            },
            "total_time": {
                "mean": model_df['total_time'].mean(),
                "median": model_df['total_time'].median(),
                "min": model_df['total_time'].min(),
                "max": model_df['total_time'].max()
            }
        }
    
    return jsonify(stats)

@app.route('/metrics/chart', methods=['GET'])
def get_metrics_chart():
    """Generate chart of metrics data"""
    if not metrics_history or len(metrics_history) < 2:
        return jsonify({"error": "Not enough metrics data for chart"})
    
    df = pd.DataFrame(metrics_history)
    
    # Sort by timestamp
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df = df.sort_values('timestamp')
    
    # Create figure with multiple subplots
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 8))
    
    # Plot TTFT by model
    for model in df['model'].unique():
        model_df = df[df['model'] == model]
        ax1.plot(model_df['timestamp'], model_df['ttft'], 'o-', label=model)
    
    ax1.set_ylabel('TTFT (ms)')
    ax1.set_title('Time to First Token by Model')
    ax1.legend()
    ax1.grid(True)
    
    # Plot total time by model
    for model in df['model'].unique():
        model_df = df[df['model'] == model]
        ax2.plot(model_df['timestamp'], model_df['total_time'], 'o-', label=model)
    
    ax2.set_ylabel('Total Time (ms)')
    ax2.set_title('Total Response Time by Model')
    ax2.legend()
    ax2.grid(True)
    
    plt.tight_layout()
    
    # Convert plot to base64 encoded string
    img = io.BytesIO()
    plt.savefig(img, format='png')
    img.seek(0)
    
    return jsonify({
        "chart": base64.b64encode(img.getvalue()).decode('utf-8')
    })

@app.route('/chat/completions', methods=['POST'])
def proxy_chat():
    """Proxy chat completions and collect metrics"""
    data = request.json
    start_time = time.time()
    start_ms = int(start_time * 1000)
    
    # Record request start
    logging.info(f"Request started at: {datetime.fromtimestamp(start_time).strftime('%H:%M:%S.%f')} ({start_ms} ms)")
    
    url = "http://3.110.176.254:4000/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": request.headers.get('Authorization', '')
    }
    
    # If streaming, process stream and collect metrics
    if data.get('stream', False):
        def generate():
            first_token_received = False
            first_token_time = None
            last_token_time = None
            
            response = requests.post(url, headers=headers, json=data, stream=True)
            
            for line in response.iter_lines():
                if line:
                    current_time = time.time()
                    current_ms = int(current_time * 1000)
                    decoded_line = line.decode('utf-8')
                    
                    # Forward the streaming response
                    yield f"{decoded_line}\n\n"
                    
                    if decoded_line.startswith("data: ") and decoded_line != "data: [DONE]":
                        try:
                            json_str = decoded_line[6:]  # Remove "data: " prefix
                            token_data = json.loads(json_str)
                            
                            # Check for content
                            if "choices" in token_data and token_data["choices"] and "delta" in token_data["choices"][0]:
                                delta = token_data["choices"][0]["delta"]
                                
                                if "content" in delta and delta["content"]:
                                    if not first_token_received:
                                        first_token_received = True
                                        first_token_time = current_time
                                        first_token_ms = current_ms
                                        ttft_ms = first_token_ms - start_ms
                                        logging.info(f"First token at: {datetime.fromtimestamp(first_token_time).strftime('%H:%M:%S.%f')} ({first_token_ms} ms)")
                                        logging.info(f"TTFT: {ttft_ms} ms")
                                    
                                    last_token_time = current_time
                                    last_token_ms = current_ms
                        except json.JSONDecodeError:
                            pass
                    
                    elif decoded_line == "data: [DONE]":
                        end_time = current_time
                        end_ms = current_ms
                        total_time_ms = end_ms - start_ms
                        
                        logging.info(f"Request completed at: {datetime.fromtimestamp(end_time).strftime('%H:%M:%S.%f')} ({end_ms} ms)")
                        logging.info(f"Total time: {total_time_ms} ms")
                        
                        generation_time_ms = None
                        if first_token_received and last_token_time:
                            generation_time_ms = last_token_ms - first_token_ms
                            logging.info(f"Token generation time: {generation_time_ms} ms")
                        
                        # Store metrics
                        metrics_entry = {
                            "timestamp": datetime.now().isoformat(),
                            "model": data.get('model', 'unknown'),
                            "ttft": first_token_ms - start_ms if first_token_ms else None,
                            "generation_time": generation_time_ms,
                            "total_time": total_time_ms
                        }
                        metrics_history.append(metrics_entry)
                        
                        # Keep only last 100 entries
                        if len(metrics_history) > 100:
                            metrics_history.pop(0)
            
            response.close()
        
        return app.response_class(generate(), mimetype='text/event-stream')
    
    # For non-streaming requests
    else:
        response = requests.post(url, headers=headers, json=data)
        end_time = time.time()
        end_ms = int(end_time * 1000)
        total_time_ms = end_ms - start_ms
        
        logging.info(f"Non-streaming request completed in {total_time_ms} ms")
        
        # Store metrics for non-streaming request
        metrics_entry = {
            "timestamp": datetime.now().isoformat(),
            "model": data.get('model', 'unknown'),
            "ttft": total_time_ms,  # For non-streaming, TTFT is the full time
            "generation_time": None,
            "total_time": total_time_ms
        }
        metrics_history.append(metrics_entry)
        
        # Keep only last 100 entries
        if len(metrics_history) > 100:
            metrics_history.pop(0)
        
        return response.content, response.status_code, response.headers.items()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)