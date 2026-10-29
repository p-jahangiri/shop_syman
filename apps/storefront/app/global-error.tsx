'use client';
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="fa" dir="rtl">
      <body
        style={{ margin: 0, fontFamily: 'sans-serif', background: '#f3f5ec', color: '#2c3b25' }}
      >
        <main style={{ maxWidth: 560, margin: '15vh auto', padding: 30 }}>
          <h1>فروشگاه موقتاً در دسترس نیست</h1>
          <p>دریافت اطلاعات به مشکل خورد. لطفاً کمی بعد دوباره تلاش کنید.</p>
          <p lang="en" dir="ltr">
            The store is temporarily unavailable. Please try again shortly.
          </p>
          <button
            onClick={reset}
            style={{
              padding: '12px 25px',
              borderRadius: 10,
              border: 0,
              background: '#425b36',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            تلاش دوباره / Retry
          </button>
        </main>
      </body>
    </html>
  );
}
