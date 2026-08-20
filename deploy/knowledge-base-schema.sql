-- =====================================================
-- KNOWLEDGE BASE / RAG SYSTEM
-- Execute this in Supabase SQL Editor
-- =====================================================

-- Documents table
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  content TEXT DEFAULT '',
  chunks_count INTEGER DEFAULT 0,
  tags TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chunks table (split document text for search)
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  tokens_estimate INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_content ON knowledge_chunks USING gin(to_tsvector('arabic', content));
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_type ON knowledge_documents(type);

-- RLS
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON knowledge_documents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON knowledge_chunks FOR ALL USING (true) WITH CHECK (true);
