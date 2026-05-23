const fs = require('fs');
let content = fs.readFileSync('src/integrations/supabase/types.ts', 'utf8');

// Add vendor_preferences to profiles
content = content.replace(/whatsapp_number: string/g, 'whatsapp_number: string\n          vendor_preferences: Json | null');
content = content.replace(/whatsapp_number\?: string/g, 'whatsapp_number?: string\n          vendor_preferences?: Json | null');

const beneficiariesType = `        swift_beneficiaries: {
          Row: {
            id: string
            user_id: string
            name: string
            account_number: string
            network_or_bank: string
            type: string
            created_at: string
            last_used_at: string | null
            usage_count: number | null
          }
          Insert: {
            id?: string
            user_id: string
            name: string
            account_number: string
            network_or_bank: string
            type: string
            created_at?: string
            last_used_at?: string | null
            usage_count?: number | null
          }
          Update: {
            id?: string
            user_id?: string
            name?: string
            account_number?: string
            network_or_bank?: string
            type?: string
            created_at?: string
            last_used_at?: string | null
            usage_count?: number | null
          }
          Relationships: [
            {
              foreignKeyName: "swift_beneficiaries_user_id_fkey"
              columns: ["user_id"]
              isOneToOne: false
              referencedRelation: "profiles"
              referencedColumns: ["user_id"]
            }
          ]
        }\n`;

content = content.replace(/Tables: \{/, 'Tables: {\n' + beneficiariesType);
fs.writeFileSync('src/integrations/supabase/types.ts', content);
console.log('types.ts patched successfully');
