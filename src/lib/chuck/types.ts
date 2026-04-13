export interface ChuckThread {
  id: string;
  aircraft_id: string;
  user_id: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChuckMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_calls: any[] | null;
  tool_results: any[] | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_create_tokens: number | null;
  model: string | null;
  created_at: string;
}
