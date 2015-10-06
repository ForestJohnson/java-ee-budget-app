package com.ilmservice.personalbudget.data;

import java.io.IOException;
import java.util.Map;

import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Data.Transaction.Builder;
import com.ilmservice.personalbudget.protobufs.Views.TransactionList;

public interface ITransactionStore {

	Transaction post(Builder builder) throws IOException;
	
	void put(Transaction transaction) throws IOException;
	
	TransactionList postAll(TransactionList transactions);
	
	TransactionList.Builder list(TransactionList query);
	
	Transaction getUnsortedTransaction();

	Map<Integer, Integer> aggregate(Long start, Long end);
}
