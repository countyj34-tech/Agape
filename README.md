# Mthunzi POS Suite

A professional Point of Sale and Inventory Management System built with React, TypeScript, and Supabase.

## Features

- Multi-tenant authentication system
- Inventory management
- Sales processing
- Online ordering
- Multi-store support
- Payment gateway integration
- PWA capabilities

## Getting Started

### Prerequisites

- Node.js 18+
- Supabase account

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up Supabase:
   - Create a new Supabase project
   - Run the database schema (see Database Setup below)
   - Update environment variables

4. Start development server:
   ```bash
   npm run dev
   ```

## Database Setup

1. Create the required tables in Supabase SQL Editor
2. Configure Row Level Security (RLS)
3. Set up authentication

## Environment Variables

Create a `.env` file with:

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPabase_ANON_KEY=your_supabase_anon_key
```

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Backend**: Supabase (PostgreSQL + Auth + Storage)
- **UI**: Tailwind CSS, shadcn/ui
- **PWA**: Vite PWA Plugin

## License

MIT
