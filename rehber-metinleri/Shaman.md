# Shaman rehber metinleri

Bu dosya rehber görsellerindeki yazıların metin hâlidir. Bot bu sayfalara cevap verirken görseli okumak yerine buradaki metni kullanır. Değiştirdikten sonra `npm run guide-text` çalıştır.

# Shaman

## shaman.01-sinif-ozeti

Başlık: WoW Forever — SHAMAN SINIF ÖZETI
Alt başlık: Üç oynanış dalı · temel rol · Forever mekanikleri

### Elemental Combat
Lightning, Shock, spell crit ve Elemental Alacrity/Lava Burst etkileşimi.

### Enhancement
Melee weapon, imbue, Shock ve totem desteğiyle hibrit hasar.

### Restoration
Chain Heal, Healing Wave, mana verimi ve grup totemleri.

### Ortak Sistem
Dört element totem slotu, weapon imbue, Shock shared cooldown ve mana yönetimi.


## shaman.02-buff-debuff

Başlık: WoW Forever — SHAMAN BUFF VE DEBUFFLARI
Alt başlık: Grup katkıları, kişisel bufflar ve hedefe uygulanan temel etkiler

### Strength of Earth Totem
Yakındaki party'ye Strength verir; fiziksel grup için temel Earth seçeneğidir.

### Grace of Air Totem
Agility verir; melee/ranged fiziksel gruplarda değerlidir.

### Windfury Totem
Party melee vuruşlarına ek saldırı proc desteği sağlar; weapon imbue ile aynı şey değildir.

### Mana Spring Totem
Yakındaki party üyelerine periyodik Mana yenileme sağlar.

### Stoneskin Totem
Alınan melee hasarı azaltan savunma totemidir.

### Resistance Totemleri
Fire/Frost/Nature resistance ihtiyaca göre seçilir; aynı element slotundaki başka totemin yerini alır.


## shaman.03-temel-mekanikler

Başlık: WoW Forever — SHAMAN TEMEL MEKANIKLERI
Alt başlık: Yeni başlayanların rotasyondan önce bilmesi gereken sistemler

### Totem Slotları
Earth, Fire, Water ve Air'den aynı anda birer totem; aynı elementten yenisi eskisini değiştirir. Menzil ve grup konumu önemlidir.

### Shock Cooldown
Earth Shock, Flame Shock ve Frost Shock ortak cooldown paylaşır; interrupt, DoT veya slow ihtiyacına göre seçilir.

### Weapon Imbue
Rockbiter, Flametongue, Frostbrand veya Windfury weapon'a uygulanır; rol ve silah hızına göre seçilir.

### Totem Aggro
Totemler düşman çekebilir ve yok edilebilir. Pull rotasında yanlış yere bırakılan eski totem zincirleme aggro yaratabilir.


## shaman.04-irk-secimi

Başlık: WoW Forever — SHAMAN IRK SEÇIMI
Alt başlık: PvE ve PvP birlikte değerlendirilmiştir; tek zorunlu ırk yoktur

### Orc
Blood Fury hem Attack hem Spell Power (cooldown 2 dk); stun süresi azaltma.

### Troll
Berserking 15 sn cast/attack speed; Beast Slaying leveling.

### Tauren
Health + Hit, War Stomp ve Plainsrunning.

### Skyborne
Wind Blessed Haste ve hareket; Elemental Insight tematik hasar avantajı.

### Dwarf
Yeni Alliance Shaman; Stoneform savunması ve Artisan's Precision ile %1 hit.


## shaman.05-ana-statlar

Başlık: WoW Forever — ANA STATLAR VE ETKILERI
Alt başlık: Ana statlar rol ve gear setine göre farklı değer kazanır

### Intellect
Maksimum Mana ve spell critical strike katkısı sağlar. Uzun savaşlarda kaynak havuzunu büyütür.

### Spirit
Cast dışı Mana/Health yenilenmesini güçlendirir; talent ve sınıf mekaniği varsa cast sırasında da değer kazanır.

### Stamina
Maksimum Health sağlar; solo, PvP ve ilerleme içeriklerinde hata payını artırır.

### Spell Power / Healing
Hasar spell'leri Spell Power; iyileştirmeler Healing ile ölçeklenir. Hibrit roller gear setini ayırmalıdır.


## shaman.06-ofansif-yan-statlar

Başlık: WoW Forever — OFANSIF YAN STATLAR
Alt başlık: Doğrulanmamış level 60 cap değerleri kesin bilgi olarak verilmez

### Spell Hit
Spell'in resist/miss olma ihtimalini düşürür. Kesin level 60 cap, içerik açılmadan Forever doğrusu olarak verilmez.

### Spell Crit
Doğrudan spell'lerde kritik şansı artırır; DoT/HoT kritik davranışı talent ve tooltip'e bağlıdır.

### Haste
Cast/GCD veya tick davranışı sistem ve spell'e göre değişebilir; beta gear dağılımı kesinleşmeden sabit öncelik verilmez.

### Mana Regeneration
Spirit, class buffları ve her 5 saniye yenileme kaynaklarıyla gelir; bağımsız gear MP5'i doğrulanmadan ezber öncelik verilmez.


## shaman.07-savunma-statlari

Başlık: WoW Forever — SAVUNMA STATLARI
Alt başlık: Armor, kaçınma ve resistance aynı şeyi yapmaz

### Armor
Yalnız Physical damage'i azaltır; magic school hasarına resistance gerekir.

### Dodge
Başarılı olduğunda uygun saldırı isabet etmez; arkadan gelen saldırılara karşı sınırlamalar vardır.

### Parry
Önden gelen melee saldırıyı savuşturur; arkadan çalışmaz.

### Resistance
Fire/Frost/Shadow/Nature/Arcane için ayrı korumadır; sonuç spell türüne göre hasar azaltma veya resist olabilir.


## shaman.17-oynanis-oncelikleri

Başlık: WoW Forever — SHAMAN OYNANIŞ ÖNCELIKLERI
Alt başlık: Oklar katı döngü değil, hedef ve kaynak durumuna göre kullanılan öncelik sırasıdır

### ELEMENTAL
Hazırlık: Lightning Shield + uygun totem seti
Öncelik: Flame Shock → Lightning Bolt → Earth Shock → Lava Burst
Shock shared cooldownını interrupt ihtiyacına sakla; Lava Burst talent/proc ve DoT koşuluna göre kullanılır.

### ENHANCEMENT
Hazırlık: Weapon imbue + Strength/Grace/Windfury grup ihtiyacı
Öncelik: Stormstrike → Earth Shock → Melee Swing → Lightning Shield
Melee uptime ve mana birlikte yönetilir; her cooldown'da pahalı Shock kullanmak downtime yaratabilir.

### RESTORATION
Hazırlık: Mana Spring + encounter totemleri; tank ve grubu ayır
Öncelik: Healing Wave → Lesser Heal → Chain Heal → Cooldown
Tek hedefte doğru heal rankı; yakın çoklu hasarda Chain Heal. Totem yenilemek için heal kaçırma.

Dipnot: Cooldown, proc, hedef sayısı ve mana/energy/rage durumu önceliği değiştirir.

## shaman.18-utility-kontrol

Başlık: WoW Forever — SHAMAN UTILITY VE KONTROL
Alt başlık: Rotasyon dışında doğru anda kullanılan savunma, dispel ve kontrol araçları

### Earth Shock
Hasar yanında spell interrupt için kullanılır; shared Shock cooldownını rastgele tüketme.

### Tremor Totem
Fear, Charm ve Sleep etkilerini periyodik temizler; etki gelmeden önce yerleştirmek önemlidir.

### Grounding Totem
Uygun düşman spell'ini toteme çeker; zamanlama ve totemin yaşam süresi kritiktir.

### Purge
Düşmandan yararlı Magic buff kaldırır.

### Cure Poison / Disease
İlgili debuff türünü temizler; Magic dispel değildir.

### Reincarnation
Reagent ve cooldown ile ölümden dönme aracıdır; wipe sonrası mı savaş içi mi kullanılacağı planlanır.


## shaman.19-leveling

Başlık: WoW Forever — SHAMAN LEVELING YOL HARITASI
Alt başlık: Solo, dungeon ve hazırlık için uygulanabilir başlangıç kararları

### Solo Varsayılan
Enhancement düşük downtime ve melee verimi sağlar; güncel silah en büyük hız artışıdır.

### Totem Ekonomisi
Her tekli mob için dört totem kurma. Kill süresi ve mana maliyetine göre yalnız gerekli olanı bırak.

### Silah ve Imbue
Silah hızı/build ilişkisine göre imbue seç; yeni weapon skillini güvenli hedeflerde geliştir.

### Emergency Heal
Combat içinde heal atmak DPS ve mana kaybettirir; düşman kontrolü veya mesafe ile güvenli cast alanı yarat.

### Dungeon
Enhancement/Elemental bile uygun Healing setiyle düşük level dungeon heal edebilir; gear setini ayrı taşı.

### Meslek
Skinning + Leatherworking veya Herbalism + Alchemy; Engineering PvP/utility seçeneğidir.

