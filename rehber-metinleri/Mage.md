# Mage rehber metinleri

Bu dosya rehber görsellerindeki yazıların metin hâlidir. Bot bu sayfalara cevap verirken görseli okumak yerine buradaki metni kullanır. Değiştirdikten sonra `npm run guide-text` çalıştır.

# Mage

## mage.01-sinif-ozeti

Başlık: WoW Forever — MAGE SINIF ÖZETI
Alt başlık: Üç oynanış dalı · temel rol · Forever mekanikleri

### Arcane
Mana, Clearcasting, Arcane Power ve spell okul esnekliği.

### Fire
Ignite, burst, crit ve kontrollü AoE.

### Frost
Slow, root, Shatter ve güçlü solo kontrol.

### Ortak Sistem
Mana gem, conjured food/water, armor spell, Polymorph ve portal utility.


## mage.02-buff-debuff

Başlık: WoW Forever — MAGE BUFF VE DEBUFFLARI
Alt başlık: Grup katkıları, kişisel bufflar ve hedefe uygulanan temel etkiler

### Arcane Intellect
Intellect artıran temel uzun süreli party buffıdır.

### Frost Armor / Ice Armor
Armor ve melee saldırgana slow/etki sağlar; savunma seçeneğidir.

### Mage Armor
Magic resistance ve mana regen odaklı armor seçeneğidir.

### Dampen Magic
Hedefin aldığı spell damage ve healing'i birlikte azaltır; fiziksel odaklı encounterda değerlidir.

### Amplify Magic
Alınan spell damage ve healing'i birlikte artırır; magic hasarı düşük durumda healer verimi için.

### Conjure Food / Water
Grubun combat dışı Health/Mana yenilenmesini sağlar; pull öncesi dağıtılır.


## mage.03-temel-mekanikler

Başlık: WoW Forever — MAGE TEMEL MEKANIKLERI
Alt başlık: Yeni başlayanların rotasyondan önce bilmesi gereken sistemler

### Armor Seçimi
Tek armor aktif olabilir. Savunma, mana regen veya encounter ihtiyacına göre değiştir.

### Five Second Rule
Mana harcayan cast sonrası doğal Spirit regen gecikir; wand, hareket ve düşük maliyetli pencereler regen planına girer.

### Shatter Kombosu
Frozen hedefe crit bonusu; Frost Nova veya freeze penceresinde nuke zamanlaması yapılır.

### AoE Kontrolü
Frost Nova, Blizzard, Cone of Cold ve Arcane Explosion farklı risk taşır; root kırılması ve threat planlanır.


## mage.04-irk-secimi

Başlık: WoW Forever — MAGE IRK SEÇIMI
Alt başlık: PvE ve PvP birlikte değerlendirilmiştir; tek zorunlu ırk yoktur

### Human
Human Spirit ile %10 Spirit, Ruthless ile %1 crit, stun temizleme ve Perception.

### Gnome
%5 maksimum Mana, Escape Artist ve Engineering güvenliği.

### Undead
Fear/Sleep/Charm temizleme ve casterlarda %10 Touch of the Grave proc (15 sn'de en fazla bir kez).

### Troll
Berserking 15 sn cast hızı ve Beast Slaying.

### Orc
Forever'da yeni Mage; Blood Fury Spell Power (cooldown 2 dk) ve Shatter Curse magic savunması.


## mage.05-ana-statlar

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


## mage.06-ofansif-yan-statlar

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


## mage.07-savunma-statlari

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


## mage.18-oynanis-oncelikleri

Başlık: WoW Forever — MAGE OYNANIŞ ÖNCELIKLERI
Alt başlık: Oklar katı döngü değil, hedef ve kaynak durumuna göre kullanılan öncelik sırasıdır

### ARCANE
Hazırlık: Arcane Intellect + uygun Armor; mana yüzdesini izle
Öncelik: Arcane Nuke → Proc / Barrage → Cooldown → Mana Yönet
Arcane Power/burst ile threati patlatma; encounter bitmeden mana tükenmeyecek tempo seç.

### FIRE
Hazırlık: Fire buff/debuff sürelerini izle
Öncelik: DoT / Scorch → Fireball → Fire Blast → Execute/Proc
Ignite/crit etkileşimleri için debuffı koru; Fire Blast hareket veya bitiriş, ana filler değildir.

### FROST
Hazırlık: Frost Armor; freeze ve mesafe planı
Öncelik: Frostbolt → Frost Nova → Shatter Nuke → Blizzard / AoE
Root kırılmadan Shatter spellini ulaştır; çoklu hedefte threat ve kaçış yolunu hazır tut.

Dipnot: Cooldown, proc, hedef sayısı ve mana/energy/rage durumu önceliği değiştirir.

## mage.19-utility-kontrol

Başlık: WoW Forever — MAGE UTILITY VE KONTROL
Alt başlık: Rotasyon dışında doğru anda kullanılan savunma, dispel ve kontrol araçları

### Polymorph
Humanoid/Beast kontrolü; hedef iyileşir ve her hasar kontrolü bozar.

### Counterspell
Spell castini keser ve ilgili school'u kısa süre kilitler; rastgele değil kritik caste saklanır.

### Remove Lesser Curse
Dosttan Curse temizler; Magic/Poison/Disease temizlemez.

### Blink
Stun/root etkilerinden kaçış ve pozisyon değişimi; düşülebilecek zemine körlemesine kullanılmaz.

### Mana Shield
Hasarı Mana'ya aktarır; hayatta kalırken DPS/kaçış manasını tüketebilir.

### Evocation
Uzun cooldown mana yenilemesi; hasar almadan kanalize edilebilecek pencere ister.


## mage.20-leveling

Başlık: WoW Forever — MAGE LEVELING YOL HARITASI
Alt başlık: Solo, dungeon ve hazırlık için uygulanabilir başlangıç kararları

### Solo Varsayılan
Frost güvenli kontrol ve düşük hasar alma sağlar; Fire hızlı ama daha riskli burst yoludur.

### Tekli Pull
Uzaktan Frostbolt/Fireball; slow ve mesafe koru. Her hedefte Arcane Explosion kullanma.

### AoE Leveling
Gear, alan ve deneyim ister. Root resist/kırılma ve respawn yüzünden her bölgede güvenli değildir.

### Food / Water
Yeni rankları öğren ve yeterli stok conjure et; grup üyelerine pull öncesi ver.

### Teleport / Portal
Şehir spellerini ve reagent ihtiyacını takip et; leveling rotasını ciddi hızlandırır.

### Meslek
Tailoring + Enchanting veya Herbalism + Alchemy; Engineering PvP kontrolü sağlar.

