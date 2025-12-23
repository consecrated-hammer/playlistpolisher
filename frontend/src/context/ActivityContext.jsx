import React from 'react';
import ActivityContext from './activityContextBase';

const ActivityProvider = ({ value, children }) => {
  return (
    <ActivityContext.Provider value={value}>
      {children}
    </ActivityContext.Provider>
  );
};

export default ActivityProvider;
