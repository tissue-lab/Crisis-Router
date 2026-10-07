import { supabaseAdmin } from '@/lib/supabase';

export interface NgoCandidate {
  id: string;
  name: string;
  category: string;
  capabilities_description: string;
  phone_number: string;
  email: string | null;
}

/**
 * Searches active NGOs using fuzzy trigram matching across name + capabilities.
 * Called by the agent as a tool — takes keywords the agent itself extracted
 * from the user's crisis description.
 */
export async function searchNgosByKeywords(
  keywords: string[]
): Promise<NgoCandidate[]> {
  if (!keywords || keywords.length === 0) {
    return [];
  }

  const orFilters = keywords
    .map((kw) => {
      const escaped = kw.replace(/[%_]/g, '').trim();
      if (!escaped) return null;
      return [
        `capabilities_description.ilike.%${escaped}%`,
        `name.ilike.%${escaped}%`,
        `category.ilike.%${escaped}%`,
      ].join(',');
    })
    .filter(Boolean)
    .join(',');

  if (!orFilters) return [];

  const { data, error } = await supabaseAdmin
    .from('ngos')
    .select('id, name, category, capabilities_description, phone_number, email')
    .eq('is_active', true)
    .or(orFilters)
    .limit(8);

  if (error) {
    console.error('searchNgosByKeywords error:', error.message);
    return [];
  }

  if (!data || data.length === 0) {
    const joined = keywords.join(' ');
    const { data: fuzzyData, error: fuzzyError } = await supabaseAdmin.rpc(
      'match_ngos_fuzzy',
      { search_text: joined, match_limit: 8 }
    );
    if (fuzzyError) {
      console.error('fuzzy fallback error:', fuzzyError.message);
      return [];
    }
    return fuzzyData ?? [];
  }

  return data;
}
