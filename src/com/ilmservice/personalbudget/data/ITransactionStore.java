package com.ilmservice.personalbudget.data;

import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Data.Transaction.Builder;

public interface ITransactionStore {

	void put(Builder builder);

}
