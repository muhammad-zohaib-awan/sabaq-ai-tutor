import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  
  if (!q) {
    return NextResponse.json({ videoId: null }, { status: 400 });
  }

  try {
    const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (!res.ok) {
      return NextResponse.json({ videoId: null }, { status: 500 });
    }
    
    const html = await res.text();
    // basic regex to find the first video ID from the ytInitialData
    const match = html.match(/"videoId":"([^"]+)"/);
    
    if (match && match[1]) {
      return NextResponse.json({ videoId: match[1] });
    }
    
    return NextResponse.json({ videoId: null });
  } catch (error) {
    return NextResponse.json({ videoId: null }, { status: 500 });
  }
}
