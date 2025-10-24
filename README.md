# AI Front Desk Receptionist - Zambian Lodge

Complete AI voice receptionist system for restaurants and lodges in Zambia. Handles both live phone calls via Twilio and web-based voice demo using WebRTC.

## 🌍 Built for Zambia

- Polite Zambian receptionist personality (not American)
- Uses Kwacha (K) for all prices
- Handles noisy lines from Airtel/MTN networks
- Collects phone numbers first (for WhatsApp/callback)
- Optional email - works without it
- Understands local accents (Lusaka, Copperbelt, North-Western)

## ✨ Features

### Voice Capabilities
- **Live Phone Calls**: Twilio voice streaming integration
- **Web Demo**: WebRTC voice interface for testing
- **AI Agent**: OpenAI Realtime API with natural conversation
- **Reservation System**: Automated booking with email confirmations

### Dashboard Pages
- **Live Demo**: Test the AI receptionist with your microphone
- **Conversations**: View all call history with real-time updates
- **Reservations**: Manage bookings (date, time, guests, area, occasion)
- **Settings**: Configure agent personality, menu, hours, pricing

## 🚀 Setup Instructions

### 1. API Keys (Already Added)

The following secrets have been configured in Lovable Cloud:
- ✅ `OPENAI_API_KEY` - For AI voice agent
- ✅ `RESEND_API_KEY` - For email confirmations
- ✅ `SUPABASE_URL` - Auto-configured
- ✅ `SUPABASE_SERVICE_ROLE_KEY` - Auto-configured

### 2. Verify Sending Domain (Resend)

To send confirmation emails from `hi@build-loop.ai`:

1. Go to [https://resend.com/domains](https://resend.com/domains)
2. Add and verify the domain `build-loop.ai`
3. Add the required DNS records (MX, TXT, etc.)
4. Wait for verification (usually 5-10 minutes)

### 3. Twilio Phone Number Setup

To connect the AI receptionist to phone calls:

#### Get Your Edge Function URL

After deployment, your Twilio webhook URL will be:
```
https://dzheddvoiauevcayifev.supabase.co/functions/v1/twilio-voice/twiml
```

#### Configure Twilio

1. Go to [Twilio Console → Phone Numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming)
2. Select your active phone number
3. Under **"Voice & Fax"** → **"A CALL COMES IN"**:
   - Set to: **Webhook**
   - Method: **HTTP POST**
   - URL: `https://dzheddvoiauevcayifev.supabase.co/functions/v1/twilio-voice/twiml`

#### Set Voice Region to Ireland (Critical for Zambia)

For better latency from Zambia:

1. In Twilio Console → Settings → Voice
2. Set **Voice Region** to: **Ireland (IE1)** or **EU (Europe)**
3. This reduces latency for callers from Zambia/Africa

#### Note for Zambian Local Numbers

Twilio doesn't sell direct +260 (Zambia) numbers. For a local experience:

**Option**: Forward an Airtel or MTN SIM to your Twilio number
- Get a local +260 number (Airtel/MTN SIM)
- Set up call forwarding to your Twilio number
- Callers dial the local +260 number
- Calls forward to Twilio → AI answers

This is a standard approach when Twilio doesn't have in-country numbers.

## 🎨 Design

- **Dark Theme**: #0A0A0A background, #1A1A1A sidebar
- **Accent**: Lime green (#84CC16)
- **Animations**: Pulsing glow on mic button, audio visualizer
- **Responsive**: Works on mobile, tablet, desktop

## 📊 Database Schema

### Tables
- `agent_config` - Restaurant settings, AI instructions, menu
- `conversations` - Call history with duration tracking
- `messages` - Conversation transcripts
- `reservations` - Bookings with guest details, area preferences, occasions

All tables have Row Level Security (RLS) enabled with public access for demo.

## 🎯 Agent Behavior

The AI receptionist:

1. **Always asks for phone number first** (for callbacks/WhatsApp)
2. **Uses Kwacha**: Prices like "K180" (never dollars)
3. **Handles noisy lines**: Politely asks caller to repeat
4. **Books reservations**: Poolside, VIP, conference hall, braai area, etc.
5. **Captures occasions**: Birthdays, meetings, romantic dinners, Independence Day
6. **Optional email**: Works fine without it
7. **Speaks Zambian English**: Not American accent

## 🛠️ Edge Functions

### 1. `twilio-voice`
- **`/twiml`**: Returns TwiML XML to start call
- **`/media-stream`**: WebSocket for Twilio ↔ OpenAI streaming
- Handles g711_ulaw audio at 24kHz
- Creates conversations and reservations
- Sends email confirmations if email provided

### 2. `realtime-session`
- Returns ephemeral OpenAI session token
- Used by web demo for WebRTC
- Configures AI personality from database

### 3. `send-reservation-confirmation`
- Sends email via Resend
- Only called if customer provides email
- Beautiful HTML template with reservation details

## 🔧 Development

### Local Development
```bash
npm install
npm run dev
```

### Edge Function Deployment
Edge functions auto-deploy with your project. No manual deployment needed!

## 🧪 Testing

### Web Demo
1. Go to **Live Demo** page
2. Click the pulsing lime green mic button
3. Allow microphone access
4. Speak naturally (as if calling a Zambian lodge)
5. Watch the event log and audio visualizer

### Phone Testing
1. Configure Twilio webhook URL (see above)
2. Call your Twilio phone number
3. AI receptionist answers and greets you
4. Make a test reservation
5. Check **Conversations** and **Reservations** pages

## 📱 Status Indicators

The Live Demo page shows real-time status:

- **Ready**: Waiting for input
- **Connecting…**: Setting up WebRTC connection
- **Talking to Guest**: AI is responding
- **Bad Network / Repeating Question**: Connection issues (common on mobile networks)

## 🎭 Example Conversation Flow

**AI**: "Hello! Thank you for calling Streamside Lodge. How may I help you today?"

**Caller**: "Hi, I want to book a table for my birthday."

**AI**: "Wonderful! Happy birthday! Let me help you with that. May I have your phone number first so I can call or WhatsApp you if needed?"

**Caller**: "It's 0977 123 456."

**AI**: "Thank you. For what date would you like to book?"

**Caller**: "Saturday, 15th February."

**AI**: "Perfect! What time works for you?"

**Caller**: "Around 7 PM."

**AI**: "Great! How many guests will be joining you?"

**Caller**: "Five people."

**AI**: "Excellent! Would you prefer any particular area? We have poolside, outdoor seating, inside dining, or our VIP section."

**Caller**: "Poolside sounds nice."

**AI**: "Perfect choice! Just to confirm: a table for 5 people on Saturday, February 15th at 7:00 PM by the poolside for your birthday celebration. Is that correct?"

**Caller**: "Yes, that's right."

**AI**: "Wonderful! Your reservation is confirmed. We look forward to celebrating with you at Streamside Lodge!"

## 🌟 Customization

Go to **Settings** page to customize:
- Restaurant/Lodge name
- Operating hours
- Menu items (include local foods: fish, braai, nshima)
- AI instructions and personality
- Currency prefix (default: K)
- Branches and seating areas

Changes apply immediately to both phone and web interfaces.

## 🔐 Security

- All tables have RLS policies
- Edge functions are public (no JWT required for webhooks)
- API keys stored securely in Lovable Cloud
- Service role key used only in backend functions

## 📞 Support

For issues or questions:
1. Check the **Event Log** in Live Demo
2. Review **Conversations** table for call history
3. Test with web demo first before phone testing

## 🎉 What's Next?

- Analytics dashboard with call metrics
- Multi-language support (add local languages)
- SMS confirmations via Africa's Talking
- Integration with payment systems (mobile money)
- Calendar sync for restaurant staff
- Customer loyalty tracking

---

**Built with**: React + TypeScript + Tailwind CSS + Supabase + OpenAI Realtime API + Twilio

**Optimized for**: Zambian restaurants, lodges, and hospitality businesses