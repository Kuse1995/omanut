/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your verification code for Omanut</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img
          src="https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/email-assets/omanut-logo.png?v=1"
          alt="Omanut"
          width="56"
          height="56"
          style={logo}
        />
        <Heading style={h1}>Your verification code</Heading>
        <Text style={text}>Use the code below to confirm your identity:</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={tagline}>we'll figure it out! 🔒</Text>
        <Text style={footer}>
          This code will expire shortly. If you didn't request this, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }
const container = { padding: '40px 32px' }
const logo = { marginBottom: '24px', borderRadius: '12px' }
const h1 = {
  fontSize: '24px',
  fontWeight: 'bold' as const,
  color: '#1f1f1f',
  margin: '0 0 20px',
  letterSpacing: '-0.02em',
}
const text = {
  fontSize: '15px',
  color: '#555555',
  lineHeight: '1.6',
  margin: '0 0 20px',
}
const codeStyle = {
  fontFamily: "'SF Mono', 'Fira Code', Courier, monospace",
  fontSize: '28px',
  fontWeight: 'bold' as const,
  color: '#84CC16',
  backgroundColor: '#f8fdf0',
  border: '1px solid #e8f5d6',
  borderRadius: '12px',
  padding: '16px 24px',
  margin: '0 0 24px',
  display: 'inline-block' as const,
  letterSpacing: '4px',
}
const tagline = {
  fontSize: '13px',
  color: '#999999',
  fontStyle: 'italic' as const,
  margin: '0 0 24px',
}
const footer = { fontSize: '12px', color: '#999999', margin: '24px 0 0', borderTop: '1px solid #f0f0f0', paddingTop: '16px' }
