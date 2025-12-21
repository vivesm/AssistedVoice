"""
Model management service
Handles LLM model operations like listing, switching, and getting info
"""
import logging
from typing import Dict, Any, Tuple
from modules.llm_factory import create_llm

logger = logging.getLogger(__name__)


class ModelService:
    """Service for managing LLM models"""

    def __init__(self, llm, config):
        """Initialize model service with current LLM and config"""
        self.llm = llm
        self.config = config

    def list_available_models(self) -> Tuple[list, str]:
        """
        Get list of available models from current LLM backend

        Returns:
            Tuple of (model_list, current_model) where model_list contains ModelInfo objects
        """
        if not self.llm:
            return [], "Loading..."

        try:
            raw_models = []
            # Check if LLM has list_models method
            if hasattr(self.llm, 'list_models'):
                raw_models = self.llm.list_models()
                current_model = self.llm.model
            # Fallback to Ollama-specific API
            else:
                models = self.llm.client.list()
                raw_models = [model.model for model in models['models']]
                current_model = self.config['ollama']['model']

            # Enrich models with capabilities
            enriched_models = []
            for name in raw_models:
                enriched_models.append({
                    'name': name,
                    'capabilities': self._infer_capabilities(name)
                })

            return enriched_models, current_model
        except Exception as e:
            logger.error(f"Error getting models: {e}")
            return [], "Error"

    def _infer_capabilities(self, model_name: str) -> list:
        """Helper to infer capabilities from model name"""
        capabilities = []
        name_lower = model_name.lower()

        # Vision capabilities
        vision_keywords = ['llava', 'vision', 'v-', 'vl', 'pixtral', 'multimodal', 'minicpm', 'moondream', 'mistral', 'ministral']
        if any(kw in name_lower for kw in vision_keywords):
            capabilities.append('vision')

        # Tool capabilities
        # Mistral is explicitly mentioned by user
        tool_keywords = ['mistral', 'command-r', 'function', 'tools']
        if any(kw in name_lower for kw in tool_keywords):
            capabilities.append('tools')

        return capabilities

    def switch_model(self, new_model: str) -> Tuple[Any, str]:
        """
        Switch to a different model

        Args:
            new_model: Name of the model to switch to

        Returns:
            Tuple of (new_llm_instance, actual_model_name)

        Raises:
            Exception if model switch fails
        """
        logger.info(f"Switching to model: {new_model}")

        # Detect which backend is active
        server_type = self.config.get('server', {}).get('type', 'ollama')

        # Determine correct config section
        if server_type == 'lm-studio':
            config_section = 'lm_studio'
        else:
            config_section = 'ollama'

        # Save old model for potential revert
        old_model = self.config.get(config_section, {}).get('model', 'unknown')

        try:
            # Update config in the correct section
            if config_section not in self.config:
                self.config[config_section] = {}
            self.config[config_section]['model'] = new_model

            # Reinitialize LLM using factory (creates correct type)
            new_llm = create_llm(self.config, optimized=True)

            # Get the actual model name that was loaded
            actual_model = new_llm.model
            
            # Sync the actual model back to the config (important for fallbacks)
            self.config[config_section]['model'] = actual_model
            
            logger.info(f"Changed model to: {actual_model}")

            return new_llm, actual_model

        except Exception as e:
            # Revert config on failure
            self.config[config_section]['model'] = old_model
            logger.error(f"Failed to switch to {new_model}, keeping {old_model}: {e}")
            raise

    def get_current_model_info(self) -> Dict[str, Any]:
        """
        Get information about the current model

        Returns:
            Dictionary with model information
        """
        return self.llm.get_model_info()
