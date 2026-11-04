'use strict';
(()=>{
 const locale=document.documentElement.lang==='en'?'en':'fa';
 const text=(fa,en)=>locale==='fa'?fa:en;
 const node=id=>document.getElementById(id);
 const privatePage=/^\/(?:fa\/|en\/)?(?:account|cart|checkout|payment|payments|orders|credit|admin)(?:\/|$)/.test(location.pathname)||location.pathname.startsWith('/api/');
 const conditionPage=/^\/(?:fa\/|en\/)?catalog\/?$/.test(location.pathname)&&new URLSearchParams(location.search).has('condition');
 const normalize=value=>String(value).normalize('NFKC').replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[\u064B-\u065F\u0670]/g,'').replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x6f0)).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x660)).replace(/\u200c/g,' ').toLowerCase().trim();
 let products=[];let categories=[];
 function element(tag,className,value){const e=document.createElement(tag);if(className)e.className=className;if(value!==undefined)e.textContent=value;return e;}
 function validImage(path){return typeof path==='string'&&(/^\/products\/[a-zA-Z0-9/_-]+\.svg$/.test(path)||/^\/media\/catalog\/[a-f0-9]{32}\/(thumb|card|zoom)\.webp$/.test(path));}
 function card(product){
  const article=element('article','product');
  if(validImage(product.image)){const image=document.createElement('img');image.src=product.image;image.alt='';image.addEventListener('error',()=>image.remove());image.loading='lazy';image.width=240;image.height=190;article.append(image);}
  article.append(element('small','brand-label',product.brand),element('h2','',product.name));
  const description=element('p','',product.description);article.append(description);
  const button=element('button','details-button',text('دیدن توضیحات','View details'));button.addEventListener('click',()=>showDetail(product));article.append(button);return article;
 }
 function showDetail(product){
  const detail=node('detail');detail.replaceChildren();detail.append(element('small','brand-label',product.brand),element('h2','',product.name),element('p','',product.description));
  const close=element('button','',text('بستن توضیحات','Close details'));close.addEventListener('click',()=>{detail.hidden=true;});detail.append(close);detail.hidden=false;detail.tabIndex=-1;detail.focus();
 }
 function filter(){const query=normalize(node('search').value);const category=node('category').value;const visible=products.filter(p=>(!category||p.category===category)&&(!query||normalize(p.name+' '+p.brand).includes(query)));node('products').replaceChildren(...visible.map(card));node('empty').hidden=visible.length>0;node('count').textContent=new Intl.NumberFormat(locale==='fa'?'fa-IR':'en-US').format(visible.length)+' '+text('کالا','products');}
 async function load(){
  node('retry').disabled=true;node('connection').textContent=text('در حال بررسی اتصال…','Checking the connection…');
  if(privatePage){node('page-title').textContent=text('این بخش به اتصال اینترنت نیاز دارد','This section needs an internet connection');node('catalog').hidden=true;node('connection').textContent=text('برای ورود، سبد و خرید، فروشگاه را پس از برقراری اتصال باز کنید.','Open the store when the connection returns to sign in, use your bag or make a purchase.');node('retry').disabled=false;return;}
  if(conditionPage){node('page-title').textContent=text('برای دیدن این فهرست دوباره وصل شوید','Reconnect to view this list');node('catalog').hidden=true;node('connection').textContent=text('وضعیت نو یا کارکردهٔ کالا در فهرست ذخیره‌شده در دسترس نیست.','The saved catalogue does not include product condition.');node('retry').disabled=false;return;}
  try{
   const response=await fetch(`/pwa/catalog/${locale}.json`,{credentials:'omit',cache:'no-cache'});
   if(!response.ok)throw new Error('unavailable');const data=await response.json();
   if(data.version!==1||data.locale!==locale||!Array.isArray(data.products)||!Array.isArray(data.categories)||typeof data.site?.name!=='string')throw new Error('invalid');
   products=data.products.filter(p=>p&&typeof p.id==='string'&&typeof p.slug==='string'&&typeof p.name==='string'&&typeof p.brand==='string'&&typeof p.category==='string'&&typeof p.description==='string');
   categories=data.categories.filter(c=>c&&typeof c.key==='string'&&typeof c.name==='string');
   node('store-name').textContent=data.site.name;document.title=data.site.name+' · '+text('مرور سبک','Lightweight view');
   if(/^#[0-9a-fA-F]{6}$/.test(data.site.primary??''))document.documentElement.style.setProperty('--primary',data.site.primary);
   node('connection').textContent=response.headers.get('X-Shop-Offline')==='1'?text('اتصال برقرار نیست؛ فهرست عمومی ذخیره‌شده نمایش داده می‌شود.','The connection is unavailable. Showing the saved public catalogue.'):text('فهرست عمومی تازه شد. این نما قیمت و موجودی نمایش نمی‌دهد.','The public catalogue is up to date. This view does not display prices or stock.');
   const at=new Date(data.generatedAt);node('saved-at').textContent=Number.isFinite(at.getTime())?text('آخرین دریافت: ','Last downloaded: ')+new Intl.DateTimeFormat(locale==='fa'?'fa-IR':'en-US',{dateStyle:'medium',timeStyle:'short'}).format(at):'';
   if(data.truncated)node('saved-at').append(document.createTextNode(text(' · بخشی از فهرست کالاها',' · A selection of the catalogue')));
   node('sample').hidden=!data.isPreview;
   const select=node('category');const all=element('option','',text('همهٔ دسته‌ها','All categories'));all.value='';select.replaceChildren(all,...categories.map(c=>{const option=element('option','',c.name);option.value=c.key;return option;}));
   node('catalog').hidden=false;filter();
   const match=location.pathname.match(/^\/(?:fa|en)\/product\/([^/]+)$/);if(match){let slug;try{slug=decodeURIComponent(match[1]);}catch{ /* An invalid URL must not select a saved product. */ }const selected=products.find(p=>p.slug===slug);if(selected)showDetail(selected);}
  }catch{node('connection').textContent=text('فهرست آفلاین در دسترس نیست. پس از برقراری اتصال دوباره تلاش کنید.','The saved catalogue is unavailable. Try again when the connection returns.');node('catalog').hidden=true;}
  finally{node('retry').disabled=false;}
 }
 // Retry the actual route, keeping its search and filters. The worker will serve the safe shell again if still offline.
 node('retry').addEventListener('click',()=>location.reload());node('search').addEventListener('input',filter);node('category').addEventListener('change',filter);void load();
})();
