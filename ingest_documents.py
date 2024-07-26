import json
import urllib.request
import urllib.error
import uuid
import hashlib

# Weaviate configuration
WEAVIATE_URL = "https://weaviate-internal.kapitol.io"
CLASS_NAME = "Perplexica"
WEAVIATE_API_KEY = "ae4009ee3e20627ca0e1603db185861a"
WEAVIATE_HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {WEAVIATE_API_KEY}",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
}
# Hasura configuration
HASURA_ENDPOINT = "https://hasura-internal.kapitol.io/v1/graphql"
HASURA_HEADERS = {
    "Content-Type": "application/json",
    "x-hasura-admin-secret": "hasura",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
}


def generate_uuid_from_content(content):
    # Generate a UUID based on the SHA-256 hash of the content
    content_hash = hashlib.sha256(content.encode('utf-8')).digest()
    return str(uuid.UUID(bytes=content_hash[:16]))

def make_request(url, method, data=None, headers=None):
    if headers is None:
        headers = {}
    headers['Content-Type'] = 'application/json'
    
    req = urllib.request.Request(url, method=method, headers=headers)
    
    if data:
        req.data = json.dumps(data).encode('utf-8')

    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        print(f"HTTP Error {e.code}: {e.reason}")
        print(f"Response body: {e.read().decode('utf-8')}")
        return None
    except urllib.error.URLError as e:
        print(f"URL Error: {e.reason}")
        return None


def fetch_documents_from_hasura():
    query = """
    query FetchDocuments {
      content_metadata(where: {file_type: {_eq: "txt"}}) {
        id
        title
        module
        section
        content
        url
      }
    }
    """
    
    data = json.dumps({"query": query}).encode('utf-8')
    req = urllib.request.Request(HASURA_ENDPOINT, data=data, headers=HASURA_HEADERS, method='POST')
    
    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode('utf-8'))
            return result['data']['content_metadata']
    except urllib.error.HTTPError as e:
        print(f"HTTP Error {e.code}: {e.reason}")
        print(f"Response body: {e.read().decode('utf-8')}")
    except urllib.error.URLError as e:
        print(f"URL Error: {e.reason}")
    except json.JSONDecodeError as e:
        print(f"JSON Decode Error: {e}")
    return None

def create_weaviate_schema():
    schema = {
        "class": CLASS_NAME,
        "vectorizer": "text2vec-openai",
        "moduleConfig": {
            # "text2vec-aws": {
            #     "model": "cohere.embed-english-v3",
            #     "region": "ap-southeast-1",
            #     "service": "bedrock",
            #     "truncate": "END",
            #     "input_type": "search_document"
            # },
            "model": "text-embedding-3-large",
            "dimensions": "3072",
            "type": "text",
            "reranker-cohere": {
                "model": "rerank-english-v3.0"
            }
        },
        "description": "A document chunk with title, content, URL, and metadata",
        "properties": [
            {
                "name": "title",
                "dataType": ["string"],
                "description": "The title of the document"
            },
            {
                "name": "module",
                "dataType": ["string"],
                "description": "The module of the document",
            },
            {
                "name": "section",
                "dataType": ["string"],
                "description": "The section of the document",
            },
            {
                "name": "content",
                "dataType": ["text"],
                "description": "The content of the document chunk"
            },
            {
                "name": "url",
                "dataType": ["string"],
                "description": "The URL of the document",
                "text2vec-openai": {
                    "skip": "true",
                    "vectorizePropertyName": "false"
                }
            },
            {
                "name": "paragraph_number",
                "dataType": ["int"],
                "description": "The paragraph number within the document",
                "text2vec-openai": {
                    "skip": "true",
                    "vectorizePropertyName": "false"
                }
            },
            {
                "name": "document_id",
                "dataType": ["int"],
                "description": "The original document ID from Hasura",
                "text2vec-openai": {
                    "skip": "true",
                    "vectorizePropertyName": "false"
                }
            }
        ]
    }
    
    response = make_request("https://weaviate-internal.kapitol.io/v1/schema", 'POST', data=schema, headers=WEAVIATE_HEADERS)
    if response:
        print("Weaviate schema created successfully.")
    else:
        print("Failed to create Weaviate schema.")

# def add_documents_to_weaviate(documents):
#     batch_url = f"{WEAVIATE_URL}/v1/batch/objects"
#     batch_size = 100
#     for i in range(0, len(documents), batch_size):
#         batch = documents[i:i+batch_size]
#         weaviate_objects = []
#         for doc in batch:
#             weaviate_object = {
#                 "class": CLASS_NAME,
#                 "id": str(uuid.uuid4()),
#                 "properties": {
#                     "title": doc["title"],
#                     "content": doc["content"],
#                     "url": doc["url"]
#                 }
#             }
#             weaviate_objects.append(weaviate_object)
        
#         response = make_request(batch_url, 'POST', data={"objects": weaviate_objects}, headers=WEAVIATE_HEADERS)
#         if response:
#             print(f"Added {len(weaviate_objects)} documents to Weaviate.")
#         else:
#             print("Failed to add documents to Weaviate.")

def search_weaviate(query):
    search_url = f"{WEAVIATE_URL}/v1/graphql"
    search_query = {
        "query": f"""
        {{
          Get {{
            {CLASS_NAME}(
              limit: 5
              where: {{
                operator: Like
                path: ["content"]
                valueString: "*{query}*"
              }}
            ) {{
              title
              content
              url
            }}
          }}
        }}
        """
    }
    return make_request(search_url, 'POST', data=search_query, headers=WEAVIATE_HEADERS)

import re

def split_into_paragraphs(content, sentences_per_chunk=5, overlap_sentences=1, min_length=50):
    # Remove leading/trailing whitespace and split into sentences
    content = content.strip()
    sentences = re.split(r'(?<=[.!?])\s+', content)
    
    chunks = []
    for i in range(0, len(sentences), sentences_per_chunk - overlap_sentences):
        chunk = sentences[i:i + sentences_per_chunk]
        if chunk:
            chunk_text = ' '.join(chunk)
            if len(chunk_text) >= min_length:
                chunks.append(chunk_text)
    
    return chunks


def ingest_documents():
    # Fetch documents from Hasura
    documents = fetch_documents_from_hasura()
    if not documents:
        print("No documents fetched from Hasura. Exiting.")
        return

    # Create Weaviate schema
    create_weaviate_schema()

    # Add documents to Weaviate
    batch_url = f"{WEAVIATE_URL}/v1/batch/objects"
    batch_size = 100
    weaviate_objects = []

    for doc in documents:
        content_uuid = generate_uuid_from_content(doc["content"])
        weaviate_object = {
            "class": CLASS_NAME,
            "id": content_uuid,
            "properties": {
                "title": doc["title"],
                "module": doc["module"],
                "section": doc["section"],
                "content": doc["content"],
                "url": doc["url"],
                "document_id": doc["id"]
            }
        }
        weaviate_objects.append(weaviate_object)

        if len(weaviate_objects) >= batch_size:
            print(f"Attempting to add {len(weaviate_objects)} objects to Weaviate")
            try:
                response = make_request(batch_url, 'POST', data={"objects": weaviate_objects}, headers=WEAVIATE_HEADERS)
                if response:
                    print(f"Successfully added {len(weaviate_objects)} chunks to Weaviate in Class {CLASS_NAME}.")
                    # flush to file system
                    with open(f"weaviate_objects_{CLASS_NAME}.json", "w") as f:
                        json.dump(weaviate_objects, f, indent=2)
                else:
                    print("Failed to add chunks to Weaviate.")
                    print(f"Response content: {response.content}")
            except Exception as e:
                print(f"Error occurred while adding chunks to Weaviate: {str(e)}")
                print("First object in batch:")
                print(json.dumps(weaviate_objects[0], indent=2))
            weaviate_objects = []

    # Add any remaining objects
    if weaviate_objects:
        response = make_request(batch_url, 'POST', data={"objects": weaviate_objects}, headers=WEAVIATE_HEADERS)
        if response:
            print(f"Added {len(weaviate_objects)} chunks to Weaviate.")
        else:
            print("Failed to add chunks to Weaviate.")

    # Perform a test search
    search_url = f"{WEAVIATE_URL}/v1/graphql"
    search_query = {
        "query": """
        {
          Get {
            Perplexica(
              limit: 5
              where: {
                operator: Like
                path: ["content"]
                valueString: "*monetization*"
              }
            ) {
              title
              content
              url
              paragraph_number
              document_id
            }
          }
        }
        """
    }
    search_results = make_request(search_url, 'POST', data=search_query, headers=WEAVIATE_HEADERS)
    if search_results:
        print(f"Search results for 'monetization': {json.dumps(search_results, indent=2)}")

if __name__ == "__main__":
    ingest_documents()
