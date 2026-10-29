export function AdminBrandIdentity() {
  return (
    <>
      <span className="admin-brand-mark" aria-hidden="true">
        <img
          src="/products/sayman-mark-olive-v1.png"
          alt=""
          width={64}
          height={64}
          decoding="async"
        />
      </span>
      <span className="admin-brand-wordmark">
        <b>سایمان</b>
        <small lang="en" dir="ltr">
          SAYMAN
        </small>
      </span>
    </>
  );
}
