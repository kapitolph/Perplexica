import axios from 'axios';
import { getHasuraAdminSecret, getHasuraApiEndpoint } from '../config';
import logger from '../utils/logger';

interface WeaviateSearchResult {
  content: string;
  title: string;
  url: string;
  embedScore: number;
  rerankScore: number;
}

export const searchWeaviate = async (
  query: string,
) => {
  const hasuraURL = getHasuraApiEndpoint();
  const hasuraSecret = getHasuraAdminSecret();

  logger.info(`Connecting to ${hasuraURL}. Query: ${query}`);

  const graphqlQuery = `
    query ComplexSearch {
      Get {
        Perplexica(hybrid: {query: "${query}"}) {
          content
          title
          url
          _additional {
            distance
            score
            rerank(query: "${query}", property: "content") {
              score
            }
          }
        }
      }
    }
  `;

  try {
    const res = await axios.post(
      `${hasuraURL}/v1/graphql`,
      { query: graphqlQuery },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-hasura-admin-secret': hasuraSecret,
        },
      }
    );

    console.log('Response:', JSON.stringify(res.data, null, 2));

    if (res.data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(res.data.errors)}`);
    }

    if (!res.data || !res.data.data || !res.data.data.Get || !res.data.data.Get.Perplexica) {
      throw new Error('Unexpected response structure');
    }

    const results: WeaviateSearchResult[] = res.data.data.Get.Perplexica.map(
      (result: any) => ({
        content: result.content,
        title: result.title,
        url: result.url,
        embedScore: result._additional.score,
        rerankScore: result._additional.rerank[0].score,
      })
    );

    return { results };
  } catch (error) {
    console.error('Error in searchWeaviate:', error);
    throw error;
  }
};
