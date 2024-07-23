interface Config {
  GENERAL: {
    PORT: number;
    SIMILARITY_MEASURE: string;
  };
  API_KEYS: {
    OPENAI: string;
    GROQ: string;
    ANTHROPIC: string;
  };
  API_ENDPOINTS: {
    SEARXNG: string;
    OLLAMA: string;
  };
}

const config: Config = {
  GENERAL: {
    PORT: parseInt(process.env.PORT || '3001', 10),
    SIMILARITY_MEASURE: process.env.SIMILARITY_MEASURE || 'cosine',
  },
  API_KEYS: {
    OPENAI: process.env.OPENAI_API_KEY || '',
    GROQ: process.env.GROQ_API_KEY || '',
    ANTHROPIC: process.env.ANTHROPIC_API_KEY || '',
  },
  API_ENDPOINTS: {
    SEARXNG: process.env.SEARXNG_API_URL || 'http://localhost:32768',
    OLLAMA: process.env.OLLAMA_API_URL || '',
  },
};

export const getPort = () => config.GENERAL.PORT;
export const getSimilarityMeasure = () => config.GENERAL.SIMILARITY_MEASURE;
export const getOpenaiApiKey = () => config.API_KEYS.OPENAI;
export const getGroqApiKey = () => config.API_KEYS.GROQ;
export const getAnthropicApiKey = () => config.API_KEYS.ANTHROPIC;
export const getSearxngApiEndpoint = () => config.API_ENDPOINTS.SEARXNG;
export const getOllamaApiEndpoint = () => config.API_ENDPOINTS.OLLAMA;

// Remove the updateConfig function as it's no longer needed
