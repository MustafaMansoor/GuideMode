const catalogSeed = [
  ['Men','Shirts','Oxford Field Shirt',68,'Sage',['Sage','White','Navy'],['S','M','L','XL'],'new'],
  ['Women','Shirts','Linen Weekend Shirt',74,'Sand',['Sand','White','Sky'],['XS','S','M','L'],'new'],
  ['Unisex','T-Shirts','Heavyweight Box Tee',38,'Clay',['Clay','Cream','Black'],['XS','S','M','L','XL'],'bestseller'],
  ['Women','Dresses','Mira Column Dress',98,'Ink',['Ink','Rust','Olive'],['XS','S','M','L'],'new'],
  ['Men','Trousers','Pleated Day Trouser',88,'Stone',['Stone','Navy','Black'],['28','30','32','34','36'],''],
  ['Women','Knitwear','Soft Rib Cardigan',82,'Oat',['Oat','Rose','Charcoal'],['XS','S','M','L'],'bestseller'],
  ['Unisex','Jackets','Canvas Chore Jacket',118,'Forest',['Forest','Tan','Navy'],['S','M','L','XL'],'limited'],
  ['Men','T-Shirts','Essential Slub Tee',32,'White',['White','Black','Moss'],['S','M','L','XL'],''],
  ['Women','Trousers','Wide Leg Studio Pant',86,'Black',['Black','Chocolate','Cream'],['XS','S','M','L'],'new'],
  ['Unisex','Sweatshirts','Loopback Crew',72,'Grey',['Grey','Navy','Burgundy'],['XS','S','M','L','XL'],''],
  ['Men','Shirts','Camp Collar Shirt',64,'Blue',['Blue','Cream','Navy'],['S','M','L','XL'],''],
  ['Women','Tops','Gathered Cotton Top',54,'Sky',['Sky','White','Rose'],['XS','S','M','L'],''],
  ['Men','Jackets','Transit Bomber',128,'Navy',['Navy','Black','Olive'],['S','M','L','XL'],'new'],
  ['Women','Dresses','Cotton Wrap Dress',92,'Rose',['Rose','Navy','Ochre'],['XS','S','M','L'],''],
  ['Unisex','Accessories','Everyday Canvas Tote',28,'Natural',['Natural','Forest','Black'],['One Size'],'bestseller'],
  ['Men','Shorts','Utility Walk Short',58,'Olive',['Olive','Stone','Black'],['28','30','32','34','36'],''],
  ['Women','Skirts','Bias Midi Skirt',76,'Chocolate',['Chocolate','Black','Sage'],['XS','S','M','L'],''],
  ['Unisex','Knitwear','Merino Mock Neck',96,'Burgundy',['Burgundy','Navy','Oat'],['XS','S','M','L','XL'],'limited'],
  ['Men','Trousers','Relaxed Twill Chino',78,'Tan',['Tan','Navy','Olive'],['28','30','32','34','36'],'bestseller'],
  ['Women','Tops','Sculpted Rib Tank',36,'Cream',['Cream','Black','Terracotta'],['XS','S','M','L'],''],
  ['Unisex','Accessories','Ribbed Beanie',26,'Ochre',['Ochre','Navy','Forest'],['One Size'],''],
  ['Men','Knitwear','Cotton Polo Knit',79,'Sky',['Sky','Cream','Navy'],['S','M','L','XL'],'new'],
  ['Women','Jackets','Cropped Work Jacket',112,'Clay',['Clay','Forest','Cream'],['XS','S','M','L'],''],
  ['Unisex','T-Shirts','Organic Pocket Tee',34,'Moss',['Moss','White','Charcoal'],['XS','S','M','L','XL'],''],
  ['Men','Sweatshirts','Zip Funnel Sweat',84,'Charcoal',['Charcoal','Oat','Navy'],['S','M','L','XL'],''],
  ['Women','Shirts','Silk Touch Blouse',89,'Ivory',['Ivory','Ink','Rose'],['XS','S','M','L'],'limited'],
  ['Unisex','Jackets','Quilted Liner Jacket',124,'Olive',['Olive','Black','Rust'],['XS','S','M','L','XL'],'bestseller'],
  ['Men','Shirts','Brushed Check Overshirt',94,'Burgundy',['Burgundy','Forest','Tan'],['S','M','L','XL'],''],
  ['Women','Trousers','Barrel Leg Jean',84,'Sky',['Sky','Ink','Cream'],['24','26','28','30','32'],'new'],
  ['Unisex','Accessories','Wool Blend Scarf',42,'Rust',['Rust','Oat','Forest'],['One Size'],''],
  ['Men','Shorts','Linen Drawcord Short',52,'Sand',['Sand','Navy','Sage'],['S','M','L','XL'],''],
  ['Women','Skirts','Utility Wrap Skirt',68,'Olive',['Olive','Black','Clay'],['XS','S','M','L'],''],
  ['Unisex','Sweatshirts','Garment Dye Hoodie',88,'Clay',['Clay','Forest','Black'],['XS','S','M','L','XL'],'new'],
  ['Men','Jackets','Corduroy Coach Jacket',116,'Chocolate',['Chocolate','Navy','Sand'],['S','M','L','XL'],'limited'],
  ['Women','Knitwear','Open Stitch Sweater',78,'Cream',['Cream','Sky','Rust'],['XS','S','M','L'],''],
  ['Unisex','Accessories','Six Panel Cap',29,'Forest',['Forest','Navy','Natural'],['One Size'],''],
  ['Men','T-Shirts','Long Sleeve Stripe Tee',44,'Navy',['Navy','Forest','Rust'],['S','M','L','XL'],''],
  ['Women','Dresses','Relaxed Poplin Dress',88,'White',['White','Sky','Black'],['XS','S','M','L'],'bestseller'],
  ['Unisex','Trousers','Easy Pull-On Pant',74,'Ink',['Ink','Sage','Stone'],['XS','S','M','L','XL'],'new'],
  ['Women','Tops','Fine Knit Polo',72,'Terracotta',['Terracotta','Cream','Black'],['XS','S','M','L'],'']
];

const colorMap={Sage:'#879782',White:'#f5f4ed',Navy:'#27374c',Blue:'#477aa5',Sand:'#cdbd9d',Sky:'#9ebccc',Clay:'#b7664b',Cream:'#e7dfc8',Black:'#242525',Ink:'#26303a',Rust:'#a34f32',Olive:'#677052',Stone:'#aaa79a',Oat:'#d5c7aa',Rose:'#c68f91',Charcoal:'#565a58',Forest:'#32543e',Tan:'#b1926c',Grey:'#939591',Burgundy:'#6d313b',Chocolate:'#674b3b',Ochre:'#bd8831',Terracotta:'#b96047',Ivory:'#eae2d2',Natural:'#d8c9aa',Moss:'#667758'};
const products=catalogSeed.map((p,i)=>({id:i+1,department:p[0],category:p[1],name:p[2],price:p[3],color:p[4],colors:p[5],sizes:p[6],badge:p[7],rating:(4.2+(i%8)/10).toFixed(1),newness:40-i,description:`A considered ${p[2].toLowerCase()} made for repeat wear. Cut for an easy, modern fit with durable finishing and a soft hand feel.`}));

let state={department:'All',categories:new Set(),sizes:new Set(),colors:new Set(),price:150,search:'',sort:'featured'};
let cart=JSON.parse(localStorage.getItem('threadly-cart')||'[]');
let modalState={product:null,size:null,color:null};
const $=s=>document.querySelector(s); const $$=s=>[...document.querySelectorAll(s)];

function art(product,compact=false){
 const bg=colorMap[product.color]||'#aaa', ink=['Black','Ink','Navy','Forest','Burgundy','Chocolate'].includes(product.color)?'#f4efe4':'#25342b';
 const type=product.category; let garment='';
 if(['Shirts','T-Shirts','Tops','Sweatshirts','Knitwear'].includes(type)) garment=`<path d="M35 40 75 20h50l40 20 25 55-31 13-12-27v104H53V81l-12 27-31-13z" fill="${ink}"/><path d="M75 20q25 32 50 0" fill="none" stroke="${bg}" stroke-width="5"/>`;
 else if(type==='Jackets') garment=`<path d="M39 42 76 20h48l37 22 24 58-28 11-13-31v105H56V80l-13 31-28-11z" fill="${ink}"/><path d="M100 22v163M73 21l27 37 27-37" stroke="${bg}" stroke-width="4" fill="none"/>`;
 else if(['Trousers','Shorts'].includes(type)) garment=`<path d="M57 22h86l${type==='Shorts'?'10 92-48 3-5-48-5 48-48-3':'-5 163H104l-4-103-4 103H62'}z" fill="${ink}"/><path d="M58 40h84M100 22v57" stroke="${bg}" stroke-width="3"/>`;
 else if(['Dresses','Skirts'].includes(type)) garment=`<path d="M73 25h54l12 48 ${type==='Dresses'?'42 112H19L61 73':'28 112H45L73 73'}z" fill="${ink}"/><path d="M73 25q27 25 54 0" fill="none" stroke="${bg}" stroke-width="4"/>`;
 else garment=`<path d="M52 68q48-75 96 0l18 106H34z" fill="${ink}"/><path d="M65 72q35 24 70 0" fill="none" stroke="${bg}" stroke-width="4"/>`;
 return `<svg viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${product.name}"><rect width="200" height="240" fill="${bg}"/><circle cx="170" cy="28" r="42" fill="#fff" opacity=".12"/><g transform="translate(0 27)">${garment}</g>${compact?'':`<text x="12" y="226" fill="${ink}" opacity=".55" font-family="Arial" font-size="7" letter-spacing="2">THREADLY / ${String(product.id).padStart(2,'0')}</text>`}</svg>`;
}

function setupFilters(){
 const cats=[...new Set(products.map(p=>p.category))].sort();
 $('#categoryFilters').innerHTML=cats.map(x=>`<label><input type="checkbox" value="${x}"> ${x}</label>`).join('');
 const sizes=['XS','S','M','L','XL','24','26','28','30','32','34','36','One Size'];
 $('#sizeFilters').innerHTML=sizes.map(x=>`<label title="${x}"><input type="checkbox" value="${x}"><span>${x==='One Size'?'OS':x}</span></label>`).join('');
 const colors=['Black','White','Cream','Navy','Blue','Forest','Olive','Sage','Sky','Clay','Rust','Rose','Chocolate'];
 $('#colorFilters').innerHTML=colors.map(x=>`<label title="${x}"><input type="checkbox" value="${x}"><span class="swatch" style="background:${colorMap[x]}"></span></label>`).join('');
}

function filteredProducts(){
 let result=products.filter(p=>(state.department==='All'||p.department===state.department)&&(!state.categories.size||state.categories.has(p.category))&&(!state.sizes.size||p.sizes.some(s=>state.sizes.has(s)))&&(!state.colors.size||p.colors.some(c=>state.colors.has(c)))&&p.price<=state.price&&(!state.search||`${p.name} ${p.category} ${p.department} ${p.colors.join(' ')}`.toLowerCase().includes(state.search.toLowerCase())));
 return result.sort((a,b)=>state.sort==='low'?a.price-b.price:state.sort==='high'?b.price-a.price:state.sort==='rating'?b.rating-a.rating:state.sort==='newest'?b.newness-a.newness:(b.badge==='bestseller')-(a.badge==='bestseller'));
}

function render(){
 const list=filteredProducts(); $('#resultCount').textContent=`${list.length} product${list.length===1?'':'s'}`;
 $('#productGrid').innerHTML=list.map(p=>`<article class="product-card"><div class="product-image" data-open="${p.id}">${art(p)}${p.badge?`<span class="product-badge">${p.badge.toUpperCase()}</span>`:''}<button class="quick-add" data-open="${p.id}">Quick add</button></div><div class="product-info"><div class="product-topline"><span class="product-name" data-open="${p.id}">${p.name}</span><span class="product-price">$${p.price}.00</span></div><div class="product-meta">${p.department} · ${p.category}</div><div class="mini-swatches">${p.colors.map(c=>`<i title="${c}" style="background:${colorMap[c]}"></i>`).join('')}</div></div></article>`).join('');
 $('#emptyState').hidden=!!list.length; $('#productGrid').hidden=!list.length;
 $$('[data-open]').forEach(el=>el.onclick=e=>{e.stopPropagation();openProduct(+el.dataset.open)});
}

function openProduct(id){
 const p=products.find(x=>x.id===id); modalState={product:p,size:null,color:p.color};
 $('#modalImage').innerHTML=art(p); $('#modalDepartment').textContent=`${p.department} / ${p.category}`; $('#modalName').textContent=p.name; $('#modalPrice').textContent=`$${p.price}.00`; $('#modalRating').textContent=`★ ${p.rating} / 5`; $('#modalDescription').textContent=p.description; $('#selectedColor').textContent=p.color; $('#selectedSize').textContent='Select a size'; $('#modalError').textContent='';
 $('#modalColors').innerHTML=p.colors.map(c=>`<button title="${c}" data-color="${c}" style="background:${colorMap[c]}" class="${c===p.color?'selected':''}"></button>`).join('');
 $('#modalSizes').innerHTML=p.sizes.map(s=>`<button data-size="${s}">${s}</button>`).join('');
 $$('#modalColors button').forEach(b=>b.onclick=()=>{modalState.color=b.dataset.color;$('#selectedColor').textContent=modalState.color;$$('#modalColors button').forEach(x=>x.classList.toggle('selected',x===b))});
 $$('#modalSizes button').forEach(b=>b.onclick=()=>{modalState.size=b.dataset.size;$('#selectedSize').textContent=modalState.size;$$('#modalSizes button').forEach(x=>x.classList.toggle('selected',x===b));$('#modalError').textContent=''});
 $('#productModal').showModal();
}

function addToCart(){
 if(!modalState.size){$('#modalError').textContent='Please select a size.';return}
 const found=cart.find(i=>i.id===modalState.product.id&&i.size===modalState.size&&i.color===modalState.color);
 if(found)found.qty++;else cart.push({id:modalState.product.id,size:modalState.size,color:modalState.color,qty:1});
 saveCart(); $('#productModal').close(); showToast(`${modalState.product.name} added to your bag`); openCart();
}
function saveCart(){localStorage.setItem('threadly-cart',JSON.stringify(cart));renderCart()}
function renderCart(){
 const count=cart.reduce((s,i)=>s+i.qty,0), total=cart.reduce((s,i)=>s+products.find(p=>p.id===i.id).price*i.qty,0); $('#cartCount').textContent=count;$('#drawerCount').textContent=`(${count})`;$('#cartEmpty').hidden=!!count;$('#cartFooter').hidden=!count;
 $('#cartItems').innerHTML=cart.map((i,n)=>{const p=products.find(x=>x.id===i.id);return `<div class="cart-item"><div class="cart-thumb">${art({...p,color:i.color},true)}</div><div><h4>${p.name}</h4><p>${i.color} / ${i.size}</p><strong>$${p.price}.00</strong><div class="quantity"><button data-dec="${n}">−</button><span>${i.qty}</span><button data-inc="${n}">+</button></div></div><button class="remove-item" data-remove="${n}">Remove</button></div>`}).join('');
 $('#subtotal').textContent=`$${total.toFixed(2)}`;const remaining=Math.max(0,75-total);$('#shippingText').textContent=remaining?`You're $${remaining.toFixed(2)} away from free shipping`:'You unlocked free shipping!';$('#shippingBar').style.width=`${Math.min(100,total/75*100)}%`;
 $$('[data-dec]').forEach(b=>b.onclick=()=>{const i=+b.dataset.dec;if(--cart[i].qty<=0)cart.splice(i,1);saveCart()});$$('[data-inc]').forEach(b=>b.onclick=()=>{cart[+b.dataset.inc].qty++;saveCart()});$$('[data-remove]').forEach(b=>b.onclick=()=>{cart.splice(+b.dataset.remove,1);saveCart()});
}
function openCart(){ $('#cartDrawer').classList.add('open');$('#cartDrawer').setAttribute('aria-hidden','false');$('#overlay').hidden=false }
function closeCart(){ $('#cartDrawer').classList.remove('open');$('#cartDrawer').setAttribute('aria-hidden','true');$('#overlay').hidden=true }
function showToast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400)}
function clearAll(){state={...state,department:'All',categories:new Set(),sizes:new Set(),colors:new Set(),price:150,search:''};$$('.filters input[type=checkbox]').forEach(x=>x.checked=false);$('.filters input[value="All"]').checked=true;$('#priceRange').value=150;$('#priceValue').textContent='$150';$('#searchInput').value='';$$('.main-nav button').forEach(x=>x.classList.toggle('active',x.dataset.department==='All'));render()}

setupFilters();render();renderCart();
$$('input[name=department]').forEach(i=>i.onchange=()=>{state.department=i.value;render()});
$('#categoryFilters').onchange=()=>{state.categories=new Set($$('#categoryFilters input:checked').map(x=>x.value));render()};
$('#sizeFilters').onchange=()=>{state.sizes=new Set($$('#sizeFilters input:checked').map(x=>x.value));render()};
$('#colorFilters').onchange=()=>{state.colors=new Set($$('#colorFilters input:checked').map(x=>x.value));render()};
$('#priceRange').oninput=e=>{state.price=+e.target.value;$('#priceValue').textContent=`$${state.price}`;render()};
$('#sortSelect').onchange=e=>{state.sort=e.target.value;render()};
$('#searchInput').oninput=e=>{state.search=e.target.value;render()};
$('#searchToggle').onclick=()=>{const p=$('#searchPanel');p.hidden=!p.hidden;if(!p.hidden)$('#searchInput').focus()};
$('#clearSearch').onclick=()=>{$('#searchInput').value='';state.search='';render()};
$('#clearFilters').onclick=$('#emptyClear').onclick=clearAll;
$$('.main-nav button').forEach(b=>b.onclick=()=>{state.department=b.dataset.department;$$('input[name=department]').forEach(x=>x.checked=x.value===state.department);$$('.main-nav button').forEach(x=>x.classList.toggle('active',x===b));render();$('#shop').scrollIntoView()});
$('#shopCollection').onclick=()=>$('#shop').scrollIntoView();$('#filterToggle').onclick=()=>$('#filters').classList.toggle('mobile-open');
$('#cartToggle').onclick=openCart;$('#cartClose').onclick=$('#continueShopping').onclick=$('#overlay').onclick=closeCart;
$('#modalClose').onclick=()=>$('#productModal').close();$('#addToCart').onclick=addToCart;
$('#checkoutButton').onclick=()=>showToast('Demo checkout — your bag is ready!');
$('#newsletterForm').onsubmit=e=>{e.preventDefault();$('#newsletterMessage').textContent='You’re on the list. Welcome!';e.target.reset()};
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeCart()});
