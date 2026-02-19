import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.1";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const brevoKey = Deno.env.get("BREVO_API_KEY");
const fromEmail = Deno.env.get("BREVO_FROM_EMAIL") || "alerts@inventory-vibe.local";
const fromName = Deno.env.get("BREVO_FROM_NAME") || "Inventory Vibe";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface LowStockPayload {
  consumable_id: string;
  name: string;
  on_hand: number;
  min_level: number;
  location: string;
  unit: string;
  updated_by_name: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    if (!brevoKey) {
      return new Response(
        JSON.stringify({ error: "Missing BREVO_API_KEY in Edge Function secrets" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload: LowStockPayload = await req.json();

    // Validate payload
    if (!payload.consumable_id || !payload.name) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if notification already sent today for this item
    const { data: recentNotif, error: checkError } = await supabase
      .from("notification_logs")
      .select("id")
      .eq("consumable_id", payload.consumable_id)
      .gte(
        "sent_at",
        new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
      )
      .eq("status", "sent")
      .limit(1);

    if (checkError) {
      console.error("Error checking notification logs:", checkError);
    }

    if (recentNotif && recentNotif.length > 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Notification already sent today for this item",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get all admin users with real email addresses
    const { data: adminUsers, error: adminError } = await supabase
      .from("user_profiles")
      .select("user_id, real_email")
      .not("real_email", "is", null);

    if (adminError) {
      console.error("Error fetching admin users:", adminError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch admin users" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!adminUsers || adminUsers.length === 0) {
      // Log failure
      await supabase.from("notification_logs").insert({
        consumable_id: payload.consumable_id,
        notification_type: "low_stock",
        status: "failed",
        sent_to_emails: [],
        trigger_value: payload.on_hand,
        error_message: "No admin users found",
      });

      return new Response(
        JSON.stringify({ error: "No admin users with email configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter: only notify users whose real_email is an actual email (not synthetic)
    const realEmails = adminUsers
      .map((u) => u.real_email)
      .filter(
        (email) =>
          email &&
          !email.endsWith("@vibe-user.example.com") &&
          email.includes("@")
      );

    if (realEmails.length === 0) {
      // Log failure
      await supabase.from("notification_logs").insert({
        consumable_id: payload.consumable_id,
        notification_type: "low_stock",
        status: "failed",
        sent_to_emails: [],
        trigger_value: payload.on_hand,
        error_message: "No admin users with real email addresses",
      });

      return new Response(
        JSON.stringify({
          error: "No admin users with real email addresses configured",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Escape HTML for safety
    function escapeHtml(text: string): string {
      return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    // Build HTML email
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #ff6b6b; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">Stock Alert</h1>
        </div>
        <div style="background: #f5f5f5; padding: 20px; border-radius: 0 0 8px 8px;">
          <p><strong>Item:</strong> ${escapeHtml(payload.name)}</p>
          <p><strong>Location:</strong> ${escapeHtml(payload.location)}</p>
          <p><strong>Current Stock:</strong> ${payload.on_hand} ${escapeHtml(
      payload.unit
    )}</p>
          <p><strong>Minimum Required:</strong> ${payload.min_level} ${escapeHtml(
      payload.unit
    )}</p>
          <p><strong>Last Updated By:</strong> ${escapeHtml(
            payload.updated_by_name
          )}</p>
          <p style="color: #999; margin-top: 30px; font-size: 12px;">
            This is an automated alert from Inventory Vibe.
          </p>
        </div>
      </div>
    `;

    // Send via Brevo transactional email API
    const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": brevoKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { email: fromEmail, name: fromName },
        to: realEmails.map((email) => ({ email })),
        subject: `LOW STOCK ALERT: ${payload.name}`,
        html: htmlContent,
      }),
    });

    if (!brevoResponse.ok) {
      const errorText = await brevoResponse.text();
      console.error(`Brevo error: ${brevoResponse.status} - ${errorText}`);

      // Log failure
      await supabase.from("notification_logs").insert({
        consumable_id: payload.consumable_id,
        notification_type: "low_stock",
        status: "failed",
        sent_to_emails: realEmails,
        trigger_value: payload.on_hand,
        error_message: `Brevo error: ${brevoResponse.status}`,
      });

      return new Response(
        JSON.stringify({
          error: `Brevo error: ${brevoResponse.status}`,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log successful notification
    await supabase.from("notification_logs").insert({
      consumable_id: payload.consumable_id,
      notification_type: "low_stock",
      status: "sent",
      sent_to_emails: realEmails,
      trigger_value: payload.on_hand,
    });

    return new Response(
      JSON.stringify({
        success: true,
        sent_to: realEmails,
        message: `Low stock notification sent to ${realEmails.length} admin(s)`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in notify-low-stock function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
