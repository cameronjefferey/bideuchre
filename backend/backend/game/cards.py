from __future__ import annotations

from dataclasses import dataclass
from enum import Enum, auto
from typing import Iterable, List


class Suit(Enum):
    CLUBS = auto()
    DIAMONDS = auto()
    HEARTS = auto()
    SPADES = auto()


class Rank(Enum):
    JACK = 11
    QUEEN = 12
    KING = 13
    ACE = 14


@dataclass(frozen=True)
class Card:
    suit: Suit
    rank: Rank

    def __str__(self) -> str:
        return f"{self.rank.name[0]} of {self.suit.name.title()}"

    def to_dict(self) -> dict:
        return {
            "suit": self.suit.name,
            "rank": self.rank.name,
        }


def double_euchre_deck_without_9s_10s() -> List[Card]:
    """Return the 32-card deck: two euchre decks without 9s and 10s.

    Each euchre deck would normally be 9 through Ace; removing 9s and 10s
    leaves J, Q, K, A in each suit -> 16 cards per deck, doubled -> 32.
    """
    deck: List[Card] = []
    for _ in range(2):  # double deck
        for suit in Suit:
            for rank in (Rank.JACK, Rank.QUEEN, Rank.KING, Rank.ACE):
                deck.append(Card(suit=suit, rank=rank))
    return deck


def is_left_bower(card: Card, trump: Suit) -> bool:
    if card.rank is not Rank.JACK:
        return False
    if trump is Suit.CLUBS:
        return card.suit is Suit.SPADES
    if trump is Suit.SPADES:
        return card.suit is Suit.CLUBS
    if trump is Suit.HEARTS:
        return card.suit is Suit.DIAMONDS
    if trump is Suit.DIAMONDS:
        return card.suit is Suit.HEARTS
    return False


def is_right_bower(card: Card, trump: Suit) -> bool:
    return card.rank is Rank.JACK and card.suit is trump


def card_is_trump(card: Card, trump: Suit) -> bool:
    return is_right_bower(card, trump) or is_left_bower(card, trump) or card.suit is trump


def trick_winner(
    plays: Iterable[Card],
    trump: Suit,
    led_suit: Suit,
) -> int:
    """Return index of winning card within plays for a completed trick.

    This uses standard Euchre ordering with right/left bowers.
    """
    cards = list(plays)
    assert cards, "Trick must contain at least one card"

    def strength(card: Card) -> int:
        # Base ordering:
        # - Trump outranks non-trump.
        # - Among trump: right bower > left bower > Ace > King > Queen > Jack (non-bower)
        # - Among non-trump following led suit: Ace > King > Queen > Jack.
        # - Off-suit, non-trump cards that don't follow suit have lowest strength.
        if is_right_bower(card, trump):
            return 100
        if is_left_bower(card, trump):
            return 99
        if card_is_trump(card, trump):
            return 80 + card.rank.value
        if card.suit is led_suit:
            return 40 + card.rank.value
        return card.rank.value

    strengths = [strength(c) for c in cards]
    return int(max(range(len(cards)), key=lambda i: strengths[i]))


def trick_winner_high_low(
    plays: Iterable[Card],
    led_suit: Suit,
    high: bool,
) -> int:
    """Return index of winning card when there is no trump (High or Low).

    In High: highest rank in led suit wins. In Low: lowest rank in led suit wins.
    Cards that do not follow led suit cannot win.
    """
    cards = list(plays)
    assert cards, "Trick must contain at least one card"
    in_suit = [(i, c) for i, c in enumerate(cards) if c.suit is led_suit]
    if not in_suit:
        return 0
    if high:
        winner_idx = max(in_suit, key=lambda p: p[1].rank.value)
    else:
        winner_idx = min(in_suit, key=lambda p: p[1].rank.value)
    return winner_idx[0]

