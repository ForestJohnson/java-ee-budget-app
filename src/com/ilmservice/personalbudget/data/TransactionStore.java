package com.ilmservice.personalbudget.data;

import java.nio.ByteBuffer;

import javax.annotation.PostConstruct;
import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import javax.inject.Inject;
import javax.inject.Singleton;

import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.repository.IRepository;
import com.ilmservice.repository.IRepository.IRepositoryIndex;

@Default
@Stateless
@Singleton
public class TransactionStore implements ITransactionStore {
	
	@Inject public IRepository<Transaction> transactions;
	public IRepositoryIndex<Integer, Transaction> transactionsById;
	
	@PostConstruct
	public void configure() {
		transactions.configure( 
			(bytes) -> Transaction.parseFrom(bytes),
			(transaction) -> transaction.toByteArray(),
			() -> {
				try {
					transactionsById = transactions.configureIndex(
						Indexes.TransactionsById.getValue(),
						(k) -> Transaction.newBuilder().setId(k).build(),
						(v) -> v.getId(),
						(k) -> ByteBuffer.allocate(4).putInt(k).array()	
					);
				} catch (Exception e) {
					e.printStackTrace();
				}
			}
		);
		

	}
}
