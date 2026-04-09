# Cameroonian Law RAG System

A production-ready NestJS backend that implements a legal RAG (Retrieval Augmented Generation) system for Cameroonian law.

## Features

- **PDF Ingestion**: Upload PDF law books (Penal Code, Criminal Procedure Code, Constitution)
- **Text Extraction**: Extracts text from PDF using pdf-parse
- **Structured Parsing**: Splits text into Articles and Sections
- **Smart Chunking**: Chunks long articles into 800-word pieces for optimal embedding
- **Vector Storage**: Stores OpenAI embeddings in PostgreSQL using pgvector
- **Similarity Search**: Cosine similarity search using pgvector
- **AI Answers**: RAG-powered question answering that prevents hallucination

## Tech Stack

- **NestJS** - Node.js framework
- **PostgreSQL** - Database
- **pgvector** - Vector similarity search
- **Prisma ORM** - Database access
- **OpenAI API** - Embeddings and chat completion
- **pdf-parse** - PDF text extraction
- **class-validator** - DTO validation

## Prerequisites

1. Node.js 18+
2. PostgreSQL with pgvector extension
3. OpenAI API key

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your values:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/cm_law?schema=public"
OPENAI_API_KEY="your-openai-api-key"
PORT=3000
NODE_ENV="development"
```

### 3. Set Up Database

Run the pgvector migration:

```bash
psql -U postgres -d cm_law -f prisma/migrations/001_enable_pgvector.sql
```

### 4. Generate Prisma Client

```bash
npm run prisma:generate
```

### 5. Run the Application

```bash
npm run start:dev
```

The API will be available at `http://localhost:3000`

## API Endpoints

### 1. Ingest PDF

Upload a PDF law document.

```bash
curl -X POST http://localhost:3000/ingestion/pdf \
  -F "file=@./penal-code.pdf" \
  -F "lawName=Penal Code"
```

### 2. Ingest Text

Ingest raw text content directly.

```bash
curl -X POST http://localhost:3000/ingestion/text \
  -H "Content-Type: application/json" \
  -d '{
    "lawName": "Penal Code",
    "content": "Article 1: The Penal Code governs criminal offenses in Cameroon..."
  }'
```

### 3. Search Law Sections

Perform similarity search on stored law sections.

```bash
curl -X POST http://localhost:3000/law/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Can police search my phone?",
    "limit": 5
  }'
```

### 4. Ask Legal Question

Get an AI-generated answer based on retrieved legal context.

```bash
curl -X POST http://localhost:3000/ai/ask \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Is it legal for police to search my phone?",
    "contextLimit": 5
  }'
```

### 5. Get Law Statistics

Get statistics about stored law sections.

```bash
curl -X GET http://localhost:3000/law/stats
```

### 6. Get Law by Name

Get all sections for a specific law.

```bash
curl -X GET http://localhost:3000/law/Penal%20Code
```

## Example Response

### Search Response

```json
[
  {
    "id": "uuid",
    "lawName": "Penal Code",
    "articleNumber": "Article 23",
    "title": "Right to Privacy",
    "content": "The private life...",
    "similarity": 0.8923
  }
]
```

### Ask Response

```json
{
  "question": "Is it legal for police to search my phone?",
  "answer": "According to Article 23 of the Penal Code, searches of personal property require a warrant issued by a competent authority. This response is for informational purposes only and does not constitute legal advice.",
  "sources": [
    {
      "lawName": "Penal Code",
      "articleNumber": "Article 23",
      "title": "Right to Privacy",
      "similarity": 0.8923,
      "contentPreview": "The private life..."
    }
  ]
}
```

## Architecture

```
src/
├── main.ts                 # Application entry point
├── app.module.ts          # Root module
├── prisma/
│   ├── prisma.service.ts  # Database service
│   └── prisma.module.ts   # Database module
├── law/
│   ├── law.module.ts      # Law module
│   ├── law.service.ts     # Similarity search & storage
│   ├── law.controller.ts  # Search endpoints
│   ├── law.parser.ts      # PDF text extraction
│   └── dto/               # Data transfer objects
├── ai/
│   ├── ai.module.ts       # AI module
│   ├── ai.service.ts      # RAG question answering
│   └── ai.controller.ts   # Ask endpoint
└── ingestion/
    ├── ingestion.module.ts    # Ingestion module
    ├── ingestion.service.ts   # PDF processing
    ├── ingestion.controller.ts # Upload endpoints
    └── dto/                   # DTOs
```

## Vector Similarity SQL

The raw SQL for cosine similarity search:

```sql
-- Generate embedding for query first
SELECT '[0.123, 0.456, ...]'::vector as query_embedding;

-- Search similar sections
SELECT 
  id,
  "lawName",
  "articleNumber",
  title,
  content,
  1 - (embedding <=> query_embedding::vector) as similarity
FROM "LawSection"
ORDER BY embedding <=> query_embedding::vector
LIMIT 5;
```

## Security

- DTO validation with class-validator
- Environment variables for all secrets
- No hardcoded API keys
- Input sanitization
- Error handling

## License

MIT