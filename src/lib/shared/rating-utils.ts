/**
 * Shared utilities for rating calculations
 */

/**
 * Calculate average rating from an array of ratings
 *
 * @param ratings - Array of rating numbers (0-10)
 * @returns Average rating, or 0 if no ratings (unrated submissions get 0 for consistent ranking)
 */
export function calculateAverageRating(ratings: number[]): number {
  if (ratings.length === 0) {
    return 0; // Unrated submissions get 0, placing them at bottom of rankings
  }

  const sum = ratings.reduce((acc, rating) => acc + rating, 0);
  return sum / ratings.length;
}

/**
 * Extract rating values from rating objects
 *
 * @param ratingObjects - Array of rating objects with a 'rating' property
 * @returns Array of rating numbers
 */
export function extractRatingValues(ratingObjects: Array<{ rating: number }>): number[] {
  return ratingObjects.map((r) => r.rating);
}

/**
 * Check if a GitHub repository is inaccessible based on processing state and error
 *
 * @param source - The source object from a submission
 * @returns true if the repository appears to be inaccessible (private or doesn't exist)
 */
export function isRepoInaccessible(source?: {
  processingState?: string;
  processingError?: string;
}): boolean {
  if (!source) return false;

  const { processingError } = source;

  // Check if there's a processing error related to repo access
  if (processingError) {
    const errorLower = processingError.toLowerCase();
    return (
      errorLower.includes('repository not found') ||
      errorLower.includes('access denied') ||
      errorLower.includes('private') ||
      errorLower.includes('authentication failed') ||
      errorLower.includes('does not exist') ||
      errorLower.includes('requires github token') ||
      errorLower.includes('not accessible') ||
      errorLower.includes('could not access')
    );
  }

  return false;
}
