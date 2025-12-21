import yaml
import os
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent.parent.parent))

from modules.llm_factory import create_llm
from services.model_service import ModelService
from modules.config_helper import save_config_to_file

def test_model_persistence():
    config_path = 'config.yaml'
    with open(config_path, 'r') as f:
        config = yaml.safe_load(f)
    
    # Ensure we use Ollama for this test if possible, or whatever is configured
    server_type = config.get('server', {}).get('type', 'ollama')
    config_section = 'ollama' if server_type == 'ollama' else 'lm_studio'
    
    original_model = config[config_section].get('model')
    print(f"Original model: {original_model}")
    
    # Initialize components
    llm = create_llm(config)
    model_service = ModelService(llm, config)
    
    # Attempt to switch to a known model (or just a suffix that might trigger fallback)
    # We'll try to switch to the same model first to see if it persists the name correctly
    test_model = original_model
    print(f"Switching to model: {test_model}")
    
    new_llm, actual_model = model_service.switch_model(test_model)
    print(f"Actual model loaded: {actual_model}")
    
    # Persist
    save_config_to_file(config)
    
    # Reload and verify
    with open(config_path, 'r') as f:
        new_config = yaml.safe_load(f)
    
    saved_model = new_config[config_section].get('model')
    print(f"Saved model in config: {saved_model}")
    
    if saved_model == actual_model:
        print("SUCCESS: Model persistence verified.")
    else:
        print(f"FAILURE: Saved model {saved_model} does not match actual model {actual_model}")

if __name__ == "__main__":
    test_model_persistence()
