# Warlock rehber metinleri

Bu dosya rehber görsellerindeki yazıların metin hâlidir. Bot bu sayfalara cevap verirken görseli okumak yerine buradaki metni kullanır. Değiştirdikten sonra `npm run guide-text` çalıştır.

# Warlock

## warlock.01-sinif-ozeti

Başlık: WARLOCK SINIF ÖZETİ
Alt başlık: Üç oynanış dalı • temel rol • Forever mekanikleri

### Affliction
DoT, drain, Wrack ve çok hedefte süre yönetimi.

### Demonology
Pet güçlendirme, Soul Link, Demonic Sacrifice/Pact kombinasyonları.

### Destruction
Shadow Bolt/Incinerate, Immolate–Conflagrate ve yüksek burst.

### Ortak Sistem
Life Tap, Soul Shard, demon seçimi, Curse/Bane sınırları ve pet micro.


## warlock.02-buff-debuff

Başlık: WARLOCK BUFF VE DEBUFFLARI
Alt başlık: Grup katkıları, kişisel bufflar ve hedefe uygulanan temel etkiler

### Demon Armor / Skin
Warlock'un kişisel Armor ve regen savunmasıdır; rank ve seviye ile gelişir.

### Healthstone
Kendine ve gruba savaş içi acil Health tüketimi sağlar.

### Soulstone
Hedefe ölüm sonrası kendini diriltme imkânı verir; önceden hazırlanır.

### Blood Pact
Imp party Stamina desteği verir; pet seçimi buffı değiştirir.

### Fire Shield
Imp'in dost hedefte melee saldırgana Fire hasarı döndüren buffıdır.

### Curse / Bane Kuralı
Bir Warlock aynı hedefte bir Curse ve sistemin izin verdiği Bane sınırlarını takip etmelidir; raid ataması önemlidir.


## warlock.03-temel-mekanikler

Başlık: WARLOCK TEMEL MEKANİKLERİ
Alt başlık: Yeni başlayanların rotasyondan önce bilmesi gereken sistemler

### Life Tap
Health'i Mana'ya çevirir; healer yükü ve Spirit ölçeklenmesi hesaba katılır. Tehlikeli hasar öncesi canı gereksiz düşürme.

### Soul Shard
Demon summon, Healthstone/Soulstone, Shadowburn ve bazı güçlü spell'ler shard tüketir; dungeon öncesi stok yapılır.

### Demon Seçimi
Imp ranged/party buff, Voidwalker solo threat, Sayaad control, Felhunter dispel/interrupt sağlar.

### DoT Snapshot ve Süre
DoT'ları erken yenilemek tick kaybettirebilir. Hedefin yaşayacağı süre, spell maliyeti ve shard getirisi birlikte düşünülür.


## warlock.04-irk-secimi

Başlık: WARLOCK IRK SEÇİMİ
Alt başlık: PvE ve PvP birlikte değerlendirilmiştir; tek zorunlu ırk yoktur

### Orc
Blood Fury Spell Power burst; Shatter Curse savunması. Command Forever'da kaldırılmıştır.

### Undead
Will of the Forsaken kontrol temizler; Touch of the Grave casterlarda %10 proc.

### Troll
Berserking cast hızı ve Rapid Regeneration.

### Human
Will to Survive, Perception ve %5 Spirit.

### Gnome
%5 maksimum Mana, Escape Artist ve daha güvenli Engineering.


## warlock.05-ana-statlar

Başlık: ANA STATLAR VE ETKİLERİ
Alt başlık: Ana statlar rol ve gear setine göre farklı değer kazanır

### Intellect
Maksimum Mana ve spell critical strike katkısı sağlar. Uzun savaşlarda kaynak havuzunu büyütür.

### Spirit
Cast dışı Mana/Health yenilenmesini güçlendirir; talent ve sınıf mekaniği varsa cast sırasında da değer kazanır.

### Stamina
Maksimum Health sağlar; solo, PvP ve ilerleme içeriklerinde hata payını artırır.

### Spell Power / Healing
Hasar spell'leri Spell Power; iyileştirmeler Healing ile ölçeklenir. Hibrit roller gear setini ayırmalıdır.


## warlock.06-ofansif-yan-statlar

Başlık: OFANSİF YAN STATLAR
Alt başlık: Doğrulanmamış level 60 cap değerleri kesin bilgi olarak verilmez

### Spell Hit
Spell'in resist/miss olma ihtimalini düşürür. Kesin level 60 cap, içerik açılmadan Forever doğrusu olarak verilmez.

### Spell Crit
Doğrudan spell'lerde kritik şansı artırır; DoT/HoT kritik davranışı talent ve tooltip'e bağlıdır.

### Haste
Cast/GCD veya tick davranışı sistem ve spell'e göre değişebilir; beta gear dağılımı kesinleşmeden sabit öncelik verilmez.

### Mana Regeneration
Spirit, class buffları ve her 5 saniye yenileme kaynaklarıyla gelir; bağımsız gear MP5'i doğrulanmadan ezber öncelik verilmez.


## warlock.07-savunma-statlari

Başlık: SAVUNMA STATLARI
Alt başlık: Armor, kaçınma ve resistance aynı şeyi yapmaz

### Armor
Yalnız Physical damage'i azaltır; magic school hasarına resistance gerekir.

### Dodge
Başarılı olduğunda uygun saldırı isabet etmez; arkadan gelen saldırılara karşı sınırlamalar vardır.

### Parry
Önden gelen melee saldırıyı savuşturur; arkadan çalışmaz.

### Resistance
Fire/Frost/Shadow/Nature/Arcane için ayrı korumadır; sonuç spell türüne göre hasar azaltma veya resist olabilir.


## warlock.18-oynanis-oncelikleri

Başlık: WARLOCK OYNANIŞ ÖNCELİKLERİ
Alt başlık: Oklar katı döngü değil, hedef ve kaynak durumuna göre kullanılan öncelik sırasıdır

### AFFLICTION
Hazırlık: Demon Armor + uygun pet; Curse/Bane atamasını kontrol et
Öncelik: Curse / Bane → Corruption → Siphon / Wrack → Shadow Bolt
Not: DoT yalnız hedef yaşayacaksa atılır; Nightfall proc olduğunda instant Shadow Bolt'u geciktirme.

### DEMONOLOGY
Hazırlık: Pet ve Master Demonologist bonusunu role göre seç
Öncelik: Pet Attack → DoT / Nuke → Pet Synergy → Life Tap
Not: Soul Link ve pet canını takip et; Demonic Sacrifice/Pact kullanıyorsan hangi petin feda edildiğini unutma.

### DESTRUCTION
Hazırlık: Immolate hedefte; Soul Shard ve threat hazır
Öncelik: Immolate → Incinerate → Conflagrate → Shadowburn
Not: Conflagrate Immolate ile, Incinerate de Immolate hedefinde güçlenir; Shadowburn execute/shard planıdır.

Dipnot: Cooldown, proc, hedef sayısı ve mana/energy/rage durumu önceliği değiştirir.

## warlock.19-utility-kontrol

Başlık: WARLOCK UTILITY VE KONTROL
Alt başlık: Rotasyon dışında doğru anda kullanılan savunma, dispel ve kontrol araçları

### Felhunter
Spell Lock interrupt/silence, Devour Magic dispel ve anti-caster utility sağlar.

### Voidwalker Sacrifice
Pet'i feda ederek absorb kalkanı verir; solo acil durum aracıdır.

### Fear
Tek hedef kontrolüdür; kaçış rotası yeni grup çekebilir. DoT bulunan hedefte kontrol hemen bozulabilir.

### Banish
Demon/Elemental hedefi kontrol eder; hedef bağışık olurken saldırılamaz.

### Healthstone
Potiondan ayrı kullanım kuralları encounter sürümüne bağlıdır; pull öncesi gruba dağıtılır.

### Soulstone
Önceden doğru hedefe koy; wipe recovery veya kritik rolün geri dönmesi için planlanır.


## warlock.20-leveling

Başlık: WARLOCK LEVELING YOL HARİTASI
Alt başlık: Solo, dungeon ve hazırlık için uygulanabilir başlangıç kararları

### Solo Varsayılan
Affliction + Voidwalker güvenli; DoT at, pet threat kurarken wand/drain ile bitir.

### DoT Ekonomisi
Ölecek hedefe tüm DoT'ları atma; mana ve cast süresi geri dönmeden hedef ölebilir.

### Life Tap Dengesi
Health ile Mana değiştir; fakat tehlikeli bölgede kendini tek vuruşluk cana indirme.

### Shard Rutini
Drain Soul ile kill sonlarını shard'a çevir; çantayı tamamen shardla doldurup loot alanını kapatma.

### Pet Görevleri
Yeni demon ve pet ability ranklarını zamanında al; taunt dungeon'da kapatılır.

### Meslek
Tailoring + Enchanting klasik caster yolu; Herbalism + Alchemy leveling tüketimleri için rahattır.

