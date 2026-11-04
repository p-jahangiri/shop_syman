'use client';

import { useState } from 'react';
import { ArrowUpRight, FileBadge2, Camera, MessageCircle, Play, Send, Shield } from 'lucide-react';
import Link from '../navigation/localized-link';
import Image from '../media/content-image';
import {
  socialLabels,
  visibleStoreIdentity,
  type StoreIdentity,
} from '@sayman/web-shared/lib/content/store-identity.ts';
import './store-identity-footer.css';

const icons = {
  instagram: Camera,
  telegram: Send,
  whatsapp: MessageCircle,
  aparat: Play,
};

export function StoreSocialLinks({
  links,
  locale,
}: {
  links: NonNullable<StoreIdentity['socialLinks']>;
  locale: 'fa' | 'en';
}) {
  return (
    <div className="store-social-links">
      {links.map(({ platform, url }) => {
        const Icon = platform === 'linkedin' ? null : icons[platform];
        const label = socialLabels[platform][locale];
        return (
          <a
            key={platform}
            className="store-social-link"
            data-platform={platform}
            href={url}
            target="_blank"
            rel="noopener noreferrer external"
            aria-label={`${label} — ${locale === 'fa' ? 'پنجرهٔ جدید' : 'new tab'}`}
            title={label}
          >
            <span className="store-social-icon">
              {Icon ? <Icon size={19} aria-hidden="true" /> : <span aria-hidden="true">in</span>}
            </span>
          </a>
        );
      })}
    </div>
  );
}
function LicenseCard({
  badge,
  locale,
}: {
  badge: NonNullable<StoreIdentity['badges']>[number];
  locale: 'fa' | 'en';
}) {
  const [failedImage, setFailedImage] = useState(false);
  const title =
    badge.kind === 'enamad' ? (locale === 'fa' ? 'نماد اعتماد الکترونیکی' : 'eNAMAD') : badge.title;
  return (
    <a
      className="store-license"
      href={badge.verificationUrl}
      target="_blank"
      rel="noopener noreferrer external"
      aria-label={`${title} — ${locale === 'fa' ? 'استعلام در پنجرهٔ جدید' : 'Verify in a new tab'}`}
    >
      <span className="store-license-visual">
        {badge.imageUrl && !failedImage ? (
          <Image
            src={badge.imageUrl}
            alt=""
            width={88}
            height={88}
            loading="lazy"
            onError={() => setFailedImage(true)}
          />
        ) : (
          <FileBadge2 size={30} aria-hidden="true" />
        )}
      </span>
      <span>
        <strong>{title}</strong>
        <small>{locale === 'fa' ? 'استعلام نزد صادرکننده' : 'Verify with issuer'}</small>
        <bdi>{new URL(badge.verificationUrl).hostname}</bdi>
      </span>
      <ArrowUpRight size={17} aria-hidden="true" />
    </a>
  );
}

export function StoreIdentityFooter({
  value,
  locale,
  part,
  showExamples = false,
}: {
  value?: StoreIdentity;
  locale: 'fa' | 'en';
  part: 'social' | 'licenses' | 'policies';
  showExamples?: boolean;
}) {
  const identity = visibleStoreIdentity(value);
  const fa = locale === 'fa';
  const socials = identity.socialLinks ?? [];
  const badges = identity.badges ?? [];
  const policies = identity.policyLinks ?? [];
  if (part === 'social')
    return socials.length ? (
      <nav className="store-social-section" aria-label={fa ? 'شبکه‌های اجتماعی' : 'Social media'}>
        <StoreSocialLinks links={socials} locale={locale} />
      </nav>
    ) : null;
  if (part === 'policies')
    return policies.length ? (
      <nav className="store-policy-links" aria-label={fa ? 'شرایط فروشگاه' : 'Store policies'}>
        {policies.map((policy) => (
          <Link key={policy.id} href={policy.href}>
            {policy.title}
          </Link>
        ))}
      </nav>
    ) : null;

  // The production API drops demonstration identities. Use the known seed slots as inert samples.
  const examples =
    showExamples && identity.demonstration
      ? (value?.badges?.filter(
          ({ id, kind }) => id === (kind === 'enamad' ? 'enamad' : 'store-license'),
        ) ?? [])
      : [];
  if (!badges.length && !examples.length) return null;
  return (
    <section className="store-license-section">
      <h3>{fa ? 'مجوزها و اعتبار' : 'Licenses and verification'}</h3>
      <div className="store-license-grid">
        {badges.map((badge) => (
          <LicenseCard key={`${badge.id}-${badge.imageUrl ?? ''}`} badge={badge} locale={locale} />
        ))}
        {examples.map(({ id }) => (
          <div key={id} className="store-license store-license-example" data-preview-badge={id}>
            <span className="store-license-visual">
              {id === 'enamad' ? (
                <Shield size={24} aria-hidden="true" />
              ) : (
                <FileBadge2 size={24} aria-hidden="true" />
              )}
            </span>
            <span>
              <strong>
                {id === 'enamad' ? (fa ? 'اینماد' : 'eNAMAD') : fa ? 'نشان اعتماد' : 'Trust mark'}
              </strong>
              <small>{fa ? 'نمونهٔ نمایشی' : 'Preview sample'}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
