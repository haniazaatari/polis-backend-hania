#!/usr/bin/env python3
"""
Model provider module for report generation.

Provides a consistent interface for different LLM backends (Ollama and Anthropic)
allowing for easy configuration and switching between model providers.
"""

import os
import json
import logging
import requests
from typing import Dict, List, Optional, Union, Any

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ModelProvider:
    """Base class for model providers."""
    
    def get_response(self, system_message: str, user_message: str) -> str:
        """
        Get a response from the model.
        
        Args:
            system_message: System message/instructions
            user_message: User message/prompt
            
        Returns:
            Model response as string
        """
        raise NotImplementedError("Subclasses must implement get_response")
    
    def list_available_models(self) -> List[str]:
        """
        List available models from this provider.
        
        Returns:
            List of available model identifiers
        """
        raise NotImplementedError("Subclasses must implement list_available_models")

class OllamaProvider(ModelProvider):
    """Provider for Ollama models."""
    
    def __init__(self, model_name: str = "llama3", endpoint: str = "http://localhost:11434"):
        """
        Initialize the Ollama provider.
        
        Args:
            model_name: Name of the model to use
            endpoint: Ollama API endpoint
        """
        self.model_name = model_name
        self.endpoint = endpoint
        
        # Import ollama here to allow for optional dependency
        try:
            import ollama
            self.ollama = ollama
            # Configure endpoint if specified
            if endpoint != "http://localhost:11434":
                self.ollama.client.api_base = endpoint
        except ImportError:
            logger.warning("Ollama package not installed. Using direct HTTP requests instead.")
            self.ollama = None
    
    def get_response(self, system_message: str, user_message: str) -> str:
        """
        Get a response from an Ollama model.
        
        Args:
            system_message: System message/instructions
            user_message: User message/prompt
            
        Returns:
            Model response as string
        """
        try:
            logger.info(f"Using Ollama model: {self.model_name}")
            
            if self.ollama:
                # Use the Ollama package if available
                response = self.ollama.chat(
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": system_message},
                        {"role": "user", "content": user_message}
                    ]
                )
                result = response['message']['content'].strip()
            else:
                # Use direct HTTP request as fallback
                response = requests.post(
                    f"{self.endpoint}/api/chat",
                    json={
                        "model": self.model_name,
                        "messages": [
                            {"role": "system", "content": system_message},
                            {"role": "user", "content": user_message}
                        ],
                        "stream": False
                    }
                )
                response.raise_for_status()
                result = response.json()["message"]["content"].strip()
            
            return result
        
        except Exception as e:
            logger.error(f"Error using Ollama: {str(e)}")
            # Return a JSON error response
            return json.dumps({
                "id": "polis_narrative_error_message",
                "title": "Model Error",
                "paragraphs": [
                    {
                        "id": "polis_narrative_error_message",
                        "title": "Error Processing With Model",
                        "sentences": [
                            {
                                "clauses": [
                                    {
                                        "text": f"There was an error using the Ollama model: {str(e)}",
                                        "citations": []
                                    }
                                ]
                            }
                        ]
                    }
                ]
            })
    
    def list_available_models(self) -> List[str]:
        """
        List available Ollama models.
        
        Returns:
            List of available model identifiers
        """
        try:
            if self.ollama:
                # Use the Ollama package if available
                models_response = self.ollama.list()
                # Handle new Ollama API response format which has a 'models' list of Model objects
                if hasattr(models_response, 'models') and isinstance(models_response.models, list):
                    available_models = [m.model for m in models_response.models]
                else:
                    # Fallback for older API versions or different response format
                    available_models = [model.get('name') for model in models_response.get('models', [])]
            else:
                # Use direct HTTP request as fallback
                response = requests.get(f"{self.endpoint}/api/tags")
                response.raise_for_status()
                available_models = [model.get('name') for model in response.json().get('models', [])]
            
            logger.info(f"Available Ollama models: {available_models}")
            return available_models
        
        except Exception as e:
            logger.error(f"Error listing Ollama models: {str(e)}")
            return []

class AnthropicProvider(ModelProvider):
    """Provider for Anthropic Claude models."""
    
    def __init__(self, model_name: str = "claude-3-sonnet-20240229", api_key: Optional[str] = None):
        """
        Initialize the Anthropic provider.
        
        Args:
            model_name: Name of the Claude model to use
            api_key: Anthropic API key (defaults to ANTHROPIC_API_KEY env var)
        """
        self.model_name = model_name
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        
        if not self.api_key:
            logger.warning("No Anthropic API key provided. Set ANTHROPIC_API_KEY env var or pass api_key parameter.")
        
        # Import anthropic here to allow for optional dependency
        try:
            import anthropic
            self.anthropic = anthropic
            self.client = anthropic.Anthropic(api_key=self.api_key)
        except ImportError:
            logger.warning("Anthropic package not installed. Using direct HTTP requests instead.")
            self.anthropic = None
            self.client = None
    
    def get_response(self, system_message: str, user_message: str) -> str:
        """
        Get a response from a Claude model.
        
        Args:
            system_message: System message/instructions
            user_message: User message/prompt
            
        Returns:
            Model response as string
        """
        if not self.api_key:
            return json.dumps({
                "id": "polis_narrative_error_message",
                "title": "API Key Missing",
                "paragraphs": [
                    {
                        "id": "polis_narrative_error_message",
                        "title": "API Key Missing",
                        "sentences": [
                            {
                                "clauses": [
                                    {
                                        "text": "No Anthropic API key provided. Set ANTHROPIC_API_KEY env var or pass api_key parameter.",
                                        "citations": []
                                    }
                                ]
                            }
                        ]
                    }
                ]
            })
        
        try:
            logger.info(f"Using Anthropic model: {self.model_name}")
            
            if self.client:
                # Use the Anthropic package if available
                message = self.client.messages.create(
                    model=self.model_name,
                    system=system_message,
                    messages=[
                        {"role": "user", "content": user_message}
                    ],
                    max_tokens=4000
                )
                result = message.content[0].text
            else:
                # Use direct HTTP request as fallback
                headers = {
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                }
                
                data = {
                    "model": self.model_name,
                    "system": system_message,
                    "messages": [
                        {"role": "user", "content": user_message}
                    ],
                    "max_tokens": 4000
                }
                
                response = requests.post(
                    "https://api.anthropic.com/v1/messages",
                    headers=headers,
                    json=data
                )
                response.raise_for_status()
                result = response.json()["content"][0]["text"]
            
            return result
        
        except Exception as e:
            logger.error(f"Error using Anthropic API: {str(e)}")
            # Return a JSON error response
            return json.dumps({
                "id": "polis_narrative_error_message",
                "title": "Model Error",
                "paragraphs": [
                    {
                        "id": "polis_narrative_error_message",
                        "title": "Error Processing With Model",
                        "sentences": [
                            {
                                "clauses": [
                                    {
                                        "text": f"There was an error using the Anthropic API: {str(e)}",
                                        "citations": []
                                    }
                                ]
                            }
                        ]
                    }
                ]
            })
    
    def list_available_models(self) -> List[str]:
        """
        List available Claude models.
        
        Returns:
            List of hardcoded available model identifiers
        """
        # Anthropic doesn't have a list models endpoint, so we hardcode the known models
        available_models = [
            "claude-3-opus-20240229", 
            "claude-3-sonnet-20240229",
            "claude-3-haiku-20240307"
        ]
        logger.info(f"Available Anthropic models: {available_models}")
        return available_models

def get_model_provider(provider_type: str = None, model_name: str = None) -> ModelProvider:
    """
    Factory function to get the appropriate model provider.
    
    Args:
        provider_type: Type of provider ('ollama', 'anthropic')
        model_name: Name of the model to use
        
    Returns:
        Configured ModelProvider instance
    """
    # Check for environment variable configuration
    provider_type = provider_type or os.environ.get("LLM_PROVIDER", "ollama")
    
    if provider_type.lower() == "anthropic":
        model_name = model_name or os.environ.get("ANTHROPIC_MODEL", "claude-3-sonnet-20240229")
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        logger.info(f"Using Anthropic provider with model: {model_name}")
        return AnthropicProvider(model_name=model_name, api_key=api_key)
    else:
        # Default to Ollama
        model_name = model_name or os.environ.get("OLLAMA_MODEL", "llama3")
        endpoint = os.environ.get("OLLAMA_ENDPOINT", "http://localhost:11434")
        logger.info(f"Using Ollama provider with model: {model_name} at {endpoint}")
        return OllamaProvider(model_name=model_name, endpoint=endpoint)

if __name__ == "__main__":
    # Simple test function
    provider = get_model_provider()
    models = provider.list_available_models()
    print(f"Available models: {models}")
    
    response = provider.get_response(
        system_message="You are a helpful assistant.",
        user_message="What is the meaning of life?"
    )
    print(f"Response: {response}")