package com.ilmservice.personalbudget.data;

import java.io.IOException;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Stream;

import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Data.Transaction.Builder;
import com.ilmservice.personalbudget.protobufs.Views.TransactionList;

public interface ITransactionStore {

	Transaction post(Builder builder) throws IOException;
	
	void put(Transaction transaction) throws IOException;
	
	TransactionList postAll(TransactionList transactions);
	
	Transaction getUnsortedTransaction();

	Map<Integer, Integer> aggregate(Long start, Long end);

	<R> R withStream(TransactionList query, Function<Stream<Transaction>, R> action);
}
