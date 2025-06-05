import time
import openai
from openai import OpenAI
import os
from dataclasses import dataclass
from typing import Optional

@dataclass
class LatencyResult:
    """Store latency measurements for a prompt."""
    prompt: str
    model: str
    ttft: float  # Time to first token (seconds)
    total_time: float  # Total response time (seconds)
    tokens_generated: int  # Approximate number of tokens
    tokens_per_second: float  # Generation speed
    response_text: str  # The actual response
    success: bool

class PromptLatencyTester:
    """Test latency for any OpenAI prompt."""
    
    def __init__(self, api_key: str = None):
        """
        Initialize the tester.
        
        Args:
            api_key: OpenAI API key. If None, uses OPENAI_API_KEY env var
        """
        if api_key:
            self.client = OpenAI(api_key=api_key)
        else:
            self.client = OpenAI()  # Uses OPENAI_API_KEY env var
    
    def test_prompt(self, 
                   prompt: str, 
                   model: str = "gpt-3.5-turbo",
                   max_tokens: int = 500,
                   temperature: float = 0.7,
                   verbose: bool = True) -> LatencyResult:
        """
        Test latency for a specific prompt.
        
        Args:
            prompt: The prompt to test
            model: OpenAI model to use
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature
            verbose: Whether to print detailed output
            
        Returns:
            LatencyResult with all timing data
        """
        if verbose:
            print(f"Testing prompt with {model}...")
            print(f"Prompt: {prompt[:100]}{'...' if len(prompt) > 100 else ''}")
            print("-" * 60)
        
        messages = [{"role": "user", "content": prompt}]
        
        start_time = time.perf_counter()
        ttft = None
        response_parts = []
        word_count = 0
        
        try:
            # Use streaming to capture precise timing
            stream = self.client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
                stream=True
            )
            
            if verbose:
                print("Response: ", end="", flush=True)
            
            for chunk in stream:
                current_time = time.perf_counter()
                
                # Check if chunk has content
                if chunk.choices[0].delta.content:
                    content = chunk.choices[0].delta.content
                    
                    # Capture time to first token
                    if ttft is None:
                        ttft = current_time - start_time
                        if verbose:
                            print(f"\n[First token at {ttft:.3f}s]", flush=True)
                            print("Response: ", end="", flush=True)
                    
                    # Collect response and count words
                    response_parts.append(content)
                    word_count += len(content.split())
                    
                    if verbose:
                        print(content, end="", flush=True)
            
            total_time = time.perf_counter() - start_time
            full_response = "".join(response_parts)
            
            # Calculate tokens per second (approximate)
            tokens_per_second = word_count / total_time if total_time > 0 else 0
            
            result = LatencyResult(
                prompt=prompt,
                model=model,
                ttft=ttft or 0,
                total_time=total_time,
                tokens_generated=word_count,
                tokens_per_second=tokens_per_second,
                response_text=full_response,
                success=True
            )
            
            if verbose:
                print(f"\n\n" + "="*60)
                self._print_metrics(result)
            
            return result
            
        except Exception as e:
            if verbose:
                print(f"\nError: {e}")
            
            return LatencyResult(
                prompt=prompt,
                model=model,
                ttft=0,
                total_time=0,
                tokens_generated=0,
                tokens_per_second=0,
                response_text="",
                success=False
            )
    
    def _print_metrics(self, result: LatencyResult):
        """Print formatted metrics."""
        print("LATENCY METRICS:")
        print(f"  Time to First Token: {result.ttft:.3f} seconds")
        print(f"  Total Response Time: {result.total_time:.3f} seconds")
        print(f"  Tokens Generated:    {result.tokens_generated}")
        print(f"  Generation Speed:    {result.tokens_per_second:.1f} tokens/sec")
        print(f"  Model Used:          {result.model}")
        print("="*60)
    
    def compare_models_for_prompt(self, 
                                 prompt: str, 
                                 models: list = None,
                                 **kwargs) -> dict:
        """
        Test the same prompt across multiple models.
        
        Args:
            prompt: The prompt to test
            models: List of models to test
            **kwargs: Additional arguments for test_prompt
            
        Returns:
            Dictionary with results for each model
        """
        if models is None:
            models = ["gpt-3.5-turbo", "gpt-4"]
        
        results = {}
        
        print(f"Comparing models for prompt:")
        print(f"'{prompt[:100]}{'...' if len(prompt) > 100 else ''}'")
        print("="*80)
        
        for model in models:
            print(f"\nTesting {model}...")
            result = self.test_prompt(prompt, model=model, verbose=False, **kwargs)
            results[model] = result
            
            if result.success:
                print(f"✓ TTFT: {result.ttft:.3f}s | Total: {result.total_time:.3f}s | Speed: {result.tokens_per_second:.1f} tok/s")
            else:
                print("✗ Failed")
        
        # Print comparison summary
        print("\n" + "="*80)
        print("COMPARISON SUMMARY")
        print("="*80)
        print(f"{'Model':<20} {'TTFT (s)':<10} {'Total (s)':<10} {'Speed (tok/s)':<15} {'Status'}")
        print("-" * 80)
        
        for model, result in results.items():
            if result.success:
                status = "✓"
                ttft = f"{result.ttft:.3f}"
                total = f"{result.total_time:.3f}"
                speed = f"{result.tokens_per_second:.1f}"
            else:
                status = "✗"
                ttft = total = speed = "N/A"
            
            print(f"{model:<20} {ttft:<10} {total:<10} {speed:<15} {status}")
        
        return results


def quick_test(prompt: str, model: str = "gpt-3.5-turbo", **kwargs):
    """
    Quick function to test a prompt without creating a class instance.
    
    Args:
        prompt: The prompt to test
        model: Model to use (default: gpt-3.5-turbo)
        **kwargs: Additional arguments
    """
    tester = PromptLatencyTester()
    return tester.test_prompt(prompt, model=model, **kwargs)


def main():
    """Interactive prompt testing."""
    tester = PromptLatencyTester()
    
    print("OpenAI Prompt Latency Tester")
    print("="*40)
    print("Enter 'quit' to exit, 'compare' to test multiple models")
    
    while True:
        print("\nEnter your prompt:")
        user_prompt = input("> ").strip()
        
        if user_prompt.lower() in ['quit', 'exit', 'q']:
            print("Goodbye!")
            break
        
        if user_prompt.lower() == 'compare':
            print("\nEnter prompt for model comparison:")
            compare_prompt = input("> ").strip()
            if compare_prompt:
                print("\nEnter models to compare (comma-separated, or press Enter for default):")
                models_input = input("Models [gpt-3.5-turbo,gpt-4]: ").strip()
                
                if models_input:
                    models = [m.strip() for m in models_input.split(',')]
                else:
                    models = ["gpt-3.5-turbo", "gpt-4"]
                
                tester.compare_models_for_prompt(compare_prompt, models)
            continue
        
        if not user_prompt:
            print("Please enter a prompt.")
            continue
        
        # Ask for model
        print(f"\nEnter model [gpt-3.5-turbo]: ", end="")
        model_choice = input().strip() or "gpt-3.5-turbo"
        
        # Test the prompt
        result = tester.test_prompt(user_prompt, model=model_choice)


if __name__ == "__main__":
    # For quick testing, you can also use:
    # result = quick_test("Explain quantum computing in simple terms")
    
    main()