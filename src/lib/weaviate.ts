import axios from 'axios';
import { getHasuraAdminSecret, getHasuraApiEndpoint } from '../config';

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

  const graphqlQuery = `
    query ComplexSearch($query: String!) {
      Get {
        Perplexica(
          hybrid: {query: $query}
        ) {
          content
          title
          url
          _additional {
            score
            rerank(query: $query, property: "content") {
              score
            }
          }
        }
      }
    }
  `;

  const variables = {
    query,
  };

  const res = await axios.post(
    `${hasuraURL}/v1/graphql`,
    { query: graphqlQuery, variables },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-hasura-admin-secret': hasuraSecret,
      },
    }
  );

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
};
