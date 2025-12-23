import { useContext } from 'react';
import PlayerContext from './playerContextBase';

const usePlayerContext = () => {
  return useContext(PlayerContext);
};

export default usePlayerContext;
