import { useRef, useState } from 'react';
import { Modal as RNModal, View, Text, ScrollView, useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { LayoutDashboard, Building2, GitBranch, Sparkles, type LucideIcon } from 'lucide-react-native';
import { Button } from '@/components/ui';
import { palette } from '@/theme/colors';
import { useOnboardingStore } from '@/store/onboardingStore';

interface Slide {
  icon: LucideIcon;
  title: string;
  description: string;
}

const SLIDES: Slide[] = [
  {
    icon: Sparkles,
    title: 'Bienvenue sur PowerLens',
    description: 'Supervisez et pilotez la consommation énergétique de votre bâtiment en temps réel.',
  },
  {
    icon: Building2,
    title: 'Visualisez votre bâtiment',
    description: "L'onglet Salles détaille chaque zone, l'onglet Jumeau en offre une vue interactive 2D/3D en direct.",
  },
  {
    icon: GitBranch,
    title: 'Automatisez avec des règles',
    description: 'Créez des règles Action → Réaction pour couper ou limiter automatiquement selon vos conditions.',
  },
  {
    icon: LayoutDashboard,
    title: "L'IA vous assiste",
    description: 'Le Smart Supervisor analyse vos données chaque nuit et propose des règles avec justification et gains estimés.',
  },
];

export function WelcomeCarousel() {
  const hasSeenIntro = useOnboardingStore((s) => s.hasSeenIntro);
  const completeIntro = useOnboardingStore((s) => s.completeIntro);
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  if (hasSeenIntro) return null;

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  const goTo = (i: number) => {
    scrollRef.current?.scrollTo({ x: i * width, animated: true });
    setIndex(i);
  };

  const isLast = index === SLIDES.length - 1;

  return (
    <RNModal visible transparent={false} animationType="fade">
      <View className="flex-1 bg-surface-alt">
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScroll}
        >
          {SLIDES.map((slide) => (
            <View key={slide.title} style={{ width }} className="flex-1 items-center justify-center px-8">
              <View className="w-20 h-20 rounded-2xl bg-primary items-center justify-center mb-6">
                <slide.icon color={palette.white} size={36} />
              </View>
              <Text className="text-text-primary text-2xl font-bold text-center mb-3">{slide.title}</Text>
              <Text className="text-text-secondary text-base text-center leading-relaxed">{slide.description}</Text>
            </View>
          ))}
        </ScrollView>

        <View className="items-center pb-2">
          <View className="flex-row gap-2 mb-6">
            {SLIDES.map((slide, i) => (
              <View
                key={slide.title}
                className={`h-2 rounded-full ${i === index ? 'w-6 bg-primary' : 'w-2 bg-surface-secondary'}`}
              />
            ))}
          </View>

          <View className="flex-row gap-3 px-8 w-full pb-8">
            {!isLast && (
              <Button variant="ghost" className="flex-1" onPress={completeIntro}>
                Passer
              </Button>
            )}
            <Button className="flex-1" onPress={() => (isLast ? completeIntro() : goTo(index + 1))}>
              {isLast ? 'Commencer' : 'Suivant'}
            </Button>
          </View>
        </View>
      </View>
    </RNModal>
  );
}
